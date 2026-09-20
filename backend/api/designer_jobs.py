"""Resumable scene design: each HTTP call does one bounded step, never a background thread.

OpenAI background responses handle reasoning; the open editor handles capture jobs.
Only the final, reauthorized transaction can mutate the saved scene.
"""
import asyncio
import copy
import hashlib
import json
import os
import uuid
from datetime import timedelta

from agents import RunConfig
from agents.tool_context import ToolContext
from django.db import transaction
from django.utils import timezone
from openai import OpenAI

from . import designer_agent
from .capture_service import capture_options
from .designer_geometry import DesignState
from .designer_service import _commit, _response, validate_payload
from .designer_vision import read_view, request_view
from .models import SceneCommandReceipt, SceneDesignJob, SceneLayout
from .scene_service import SceneError, scene_for_session, serialize


def public(job):
    if job.phase == 'done':
        return {'jobId': str(job.pk), 'status': 'completed', **job.result}
    if job.phase == 'failed':
        return {'jobId': str(job.pk), 'status': 'failed', **job.result}
    messages = {'before': 'Reading the room and its views…', 'planning': 'Designing with the room’s objects and measurements…',
                'tool_capture': 'Inspecting a requested view…', 'preview': 'Checking a preview before saving…',
                'after': 'Layout saved. Capturing the result…', 'verifying': 'Layout saved. Reviewing the image…'}
    return {'jobId': str(job.pk), 'status': 'running', 'phase': job.phase,
            'message': messages.get(job.phase, 'Working on your layout…'), 'roomId': job.scene.room_id,
            'baseRevision': job.data['payload']['baseRevision']}


def active_request(scene):
    job = SceneDesignJob.objects.filter(scene=scene,created_at__gt=timezone.now()-timedelta(minutes=20)).exclude(phase__in=['done','failed']).order_by('-created_at').first()
    if not job:
        return None
    return {'payload':job.data['payload'], 'before':job.data.get('beforeInstances',job.data['snapshot']['instances'])}


def restore(job):
    data = job.data
    selection = data['payload'].get('selectedId') if not data.get('acceptedRevision') else None
    state = DesignState(data['snapshot'], str(job.request_id), selection, data['payload'].get('camera'))
    state.instances = copy.deepcopy(data.get('instances', state.instances))
    state.commands = copy.deepcopy(data.get('commands', []))
    state.trace = copy.deepcopy(data.get('trace', []))
    return state


def store_state(job, state):
    job.data.update(instances=state.instances, commands=state.commands, trace=state.trace)


def staged_hash(state):
    return hashlib.sha256(json.dumps(state.instances, sort_keys=True).encode()).hexdigest()


@transaction.atomic
def begin(session, room_id, payload, authorize=None):
    request_id, digest = validate_payload(payload)
    if authorize:
        authorize()
    scene = scene_for_session(session, room_id)
    previous = SceneDesignJob.objects.filter(scene=scene, request_id=request_id).first()
    if previous:
        if previous.request_hash != digest:
            raise SceneError('request_conflict', 'Request ID already used for different designer input.', 409)
        return public(previous)
    if scene.revision != payload['baseRevision']:
        raise SceneError('revision_conflict', 'The room changed. Reload before asking the designer.', 409, scene.revision)
    snapshot = serialize(scene)
    if payload.get('camera') is not None:
        capture_options({'view': 'perspective', 'camera': payload['camera']}, snapshot['room'])
    DesignState(snapshot, request_id, payload.get('selectedId'), payload.get('camera'))
    if not os.getenv('OPENAI_API_KEY'):
        raise SceneError('agent_unconfigured', 'The scene designer needs OPENAI_API_KEY on the backend.', 503)
    if SceneDesignJob.objects.filter(scene=scene).exclude(phase__in=['done','failed']).filter(created_at__gt=timezone.now()-timedelta(minutes=20)).exists():
        raise SceneError('designer_busy', 'Finish the current designer request before starting another.', 409)
    job = SceneDesignJob.objects.create(scene=scene, request_id=request_id, request_hash=digest,
                                       data={'payload': payload, 'snapshot': snapshot, 'beforeInstances':snapshot['instances'], 'turn': 0, 'captures': [], 'evidence': []})
    return public(job)


@transaction.atomic
def claim(session, room_id, job_id, authorize):
    if authorize:
        authorize()
    job = SceneDesignJob.objects.select_for_update().select_related('scene').filter(
        pk=job_id, scene__session_key=session, scene__room_id=room_id).first()
    if not job:
        raise SceneError('not_found', 'Designer request not found in this room.', 404)
    if job.phase in ('done','failed') or job.lease_until and job.lease_until > timezone.now():
        return job, False
    job.lease_token, job.lease_until = uuid.uuid4(), timezone.now()+timedelta(seconds=45)
    job.save(update_fields=['lease_token','lease_until'])
    return job, True


def images_input(captures, text):
    content = [{'type': 'input_text', 'text': text}]
    for capture in captures:
        metadata = {k:v for k,v in capture.items() if k != 'imageDataUrl'}
        content.extend([{'type': 'input_text', 'text': json.dumps(metadata)},
                        {'type': 'input_image', 'image_url': capture['imageDataUrl'], 'detail': 'auto'}])
    return {'role': 'user', 'content': content}


def submit_model(job, inputs, verification=False):
    tools = [{'type': 'function', 'name': tool.name, 'description': tool.description,
              'parameters': tool.params_json_schema, 'strict': True} for tool in designer_agent.TOOLS]
    instructions = designer_agent.INSTRUCTIONS
    if verification:
        instructions = ('Review this real accepted-layout image against the request and saved context. '
                        'Describe visible successes or problems; if furniture is occluded/off camera, say visual verification is incomplete. '
                        'Projected boxes do not prove visibility. Do not invent measurements. No edits. Return apply=false and a concise message.')
    args = {'model': os.getenv('DESIGNER_MODEL') or 'gpt-6-astra', 'reasoning': {'effort': 'xhigh'},
            'background': True, 'store': True, 'instructions': instructions, 'input': inputs,
            'max_output_tokens': 16384, 'parallel_tool_calls': False, 'tools': [] if verification else tools,
            'text': {'format': {'type': 'json_schema', 'name': 'layout_reply', 'strict': True,
                                 'schema': designer_agent.PlanReply.model_json_schema() | {'additionalProperties': False}}}}
    if job.data.get('responseId'):
        args['previous_response_id'] = job.data['responseId']
    with OpenAI(timeout=20, max_retries=0) as client:
        response = client.responses.create(**args)
    job.data['responseId'] = response.id
    job.data['turn'] += 1


def queue_views(job, state, session, phase, preview=False):
    views = ['perspective', 'top'] if phase == 'before' else ['perspective']
    if phase == 'after':
        state.camera = state.review_camera()
    job.data['captures'] = []
    for view in views:
        result = request_view(state, session, f'design:{job.pk}:{phase}:{job.data["turn"]}:{view}', view=view, preview=preview)
        job.data['captures'].append(result['captureId'])
    job.phase = phase


def completed_views(job, session):
    captures = [read_view(session, job.scene.room_id, identifier) for identifier in job.data['captures']]
    for capture in captures:
        if capture.get('status') == 'failed' or not capture.get('ok', True):
            raise SceneError('capture_unavailable', 'The room view could not be captured. Keep the room open and try again.')
    if not all(c.get('status') == 'ready' and c.get('imageDataUrl') for c in captures):
        return None
    expected = job.data.get('acceptedRevision', job.data['payload']['baseRevision'])
    if any(c['revision'] != expected for c in captures):
        raise SceneError('revision_conflict', 'The captured room does not match this designer request.', 409)
    return captures


def finish_report(job, note, status):
    receipt = SceneCommandReceipt.objects.get(scene=job.scene, command_id='designer:'+str(job.request_id))
    report = receipt.response['_designer']
    report.update(visualStatus=status, visualNote=note, evidence=job.data['evidence'],
                  model=os.getenv('DESIGNER_MODEL') or 'gpt-6-astra', reasoningEffort='xhigh')
    receipt.save(update_fields=['response'])
    job.result, job.phase = _response(receipt), 'done'


def advance(job, session, authorize):
    state = restore(job)
    payload = job.data['payload']
    receipt = SceneCommandReceipt.objects.filter(scene=job.scene, command_id='designer:'+str(job.request_id)).first()
    if receipt and not job.data.get('acceptedRevision'):
        # The worker may have lost its lease/connection after the atomic save.
        # Recover the receipt before considering the old revision stale.
        if not receipt.response['_designer']['appliedCount']:
            job.result, job.phase = _response(receipt), 'done'
            return
        job.data['acceptedRevision'] = receipt.response['revision']
        state.snapshot = {k:v for k,v in receipt.response.items() if k != '_designer'}
        job.data['snapshot'] = state.snapshot
        job.phase = 'after'
        queue_views(job, state, session, 'after')
        return
    if job.created_at < timezone.now()-timedelta(minutes=20):
        raise SceneError('designer_timeout', 'The designer session expired. Your saved layout is preserved.')
    if job.data['turn'] >= 36:
        raise SceneError('designer_limit', 'This request reached its reasoning limit. Try a smaller arrangement.')
    if job.phase not in ('after','verifying'):
        current = scene_for_session(session, job.scene.room_id)
        if current.revision != payload['baseRevision']:
            raise SceneError('revision_conflict', 'The room changed while the designer worked. Review it and try again.', 409, current.revision)
    if job.phase == 'before' and not job.data['captures']:
        queue_views(job, state, session, 'before')
        return
    if job.phase in ('before','preview','after','tool_capture'):
        captures = completed_views(job, session)
        if captures is None:
            return
        job.data['evidence'].extend({k:v for k,v in c.items() if k not in ('imageDataUrl','objectProjection')} for c in captures)
        if job.phase == 'before':
            from .designer_context import inspect_context
            inputs = [images_input(captures, json.dumps({'request': payload['text'], 'scene': inspect_context(state)}))]
        elif job.phase == 'tool_capture':
            inputs = [job.data.pop('captureOutput'), images_input(captures, 'Requested view with projected object identities; occlusion is unknown.')]
        elif job.phase == 'preview':
            job.data['reviewedHash'] = staged_hash(state)
            inputs = [images_input(captures, 'This is the staged preview, before save. Inspect it. Revise with tools if needed; otherwise return apply=true to accept this exact arrangement.')]
        else:
            submit_model(job, [images_input(captures, json.dumps({'request':payload['text'], 'savedScene':state.inspect()}))], verification=True)
            job.phase = 'verifying'
            return
        submit_model(job, inputs)
        job.phase = 'planning'
        return
    with OpenAI(timeout=20, max_retries=0) as client:
        response = client.responses.retrieve(job.data['responseId'])
    if response.status in ('queued','in_progress'):
        return
    if response.status != 'completed':
        raise SceneError('agent_unavailable', 'The model did not finish this design step. Try a smaller request.')
    if job.phase == 'verifying':
        reply = designer_agent.PlanReply.model_validate_json(response.output_text)
        finish_report(job, reply.message[:500], 'reviewed')
        return
    calls = [item for item in response.output if item.type == 'function_call']
    if calls:
        if len(calls) != 1:
            raise SceneError('agent_protocol', 'The designer returned an unsupported simultaneous tool batch.')
        call = calls[0]
        tool = next((tool for tool in designer_agent.TOOLS if tool.name == call.name), None)
        if not tool:
            raise SceneError('agent_protocol', 'The designer requested an unknown tool.')
        state.request_view = lambda view, target, preview: request_view(
            state, session, f'design:{job.pk}:tool:{job.data["turn"]}', view=view, target_id=target, preview=preview)
        ctx = ToolContext(context=state, tool_name=call.name, tool_call_id=call.call_id,
                          tool_arguments=call.arguments, run_config=RunConfig(tracing_disabled=True))
        result = asyncio.run(tool.on_invoke_tool(ctx, call.arguments))
        output = {'type':'function_call_output','call_id':call.call_id,
                  'output':result if isinstance(result,str) else json.dumps(result)}
        store_state(job, state)
        parsed = json.loads(result) if isinstance(result,str) else result
        if call.name == 'capture_view' and isinstance(parsed,dict) and parsed.get('captureId'):
            job.data.update(captures=[parsed['captureId']],captureOutput=output)
            job.phase = 'tool_capture'
        else:
            submit_model(job, [output])
        return
    reply = designer_agent.PlanReply.model_validate_json(response.output_text)
    if reply.apply and state.commands and job.data.get('reviewedHash') != staged_hash(state):
        queue_views(job, state, session, 'preview', preview=True)
        return
    receipt, _ = _commit(session, state, payload['baseRevision'], 'designer:'+str(job.request_id),
                          job.request_hash, reply, authorize=authorize)
    if not receipt.response['_designer']['appliedCount']:
        job.result, job.phase = _response(receipt), 'done'
        return
    job.data['acceptedRevision'] = receipt.response['revision']
    state.snapshot = {k:v for k,v in receipt.response.items() if k != '_designer'}
    job.data['snapshot'] = state.snapshot
    job.phase = 'after'  # Even if capture creation fails, the save already happened.
    queue_views(job, state, session, 'after')


def poll(session, room_id, job_id, authorize=None):
    job, claimed = claim(session, room_id, job_id, authorize)
    if not claimed:
        return public(job)
    token = job.lease_token
    try:
        advance(job, session, authorize)
    except Exception as error:
        if job.phase in ('after','verifying'):
            finish_report(job, 'Layout saved and geometry checked. Visual review did not finish.', 'unavailable')
        else:
            code = error.code if isinstance(error,SceneError) else 'agent_unavailable'
            message = error.message if isinstance(error,SceneError) else 'The designer could not finish. Your layout was not changed.'
            job.phase, job.result = 'failed', {'error': {'code': code, 'message': message}}
    SceneDesignJob.objects.filter(pk=job.pk,lease_token=token).update(
        phase=job.phase,data=job.data,result=job.result,lease_token=None,lease_until=None,updated_at=timezone.now())
    return public(job)
