"""Session-scoped plan -> atomic commit -> rendered evidence. No long DB transaction around a model call."""
import hashlib
import json
import time
import uuid

from django.db import transaction

from . import designer_agent
from .capture_service import capture_options
from .designer_geometry import DesignState
from .engine_tools import read_scene_capture, request_scene_capture
from .models import SceneCommandReceipt, SceneLayout
from .scene_service import SceneError, apply_scene_commands, scene_for_session, serialize, validate_revision


def _response(receipt):
    saved = receipt.response
    return {'scene': {k: v for k, v in saved.items() if k != '_designer'},
            'designer': {k: v for k, v in saved['_designer'].items() if k != 'requestHash'}}


def _replay(scene, command_id, digest):
    receipt = SceneCommandReceipt.objects.filter(scene=scene, command_id=command_id).first()
    if receipt and receipt.response.get('_designer', {}).get('requestHash') != digest:
        raise SceneError('request_conflict', 'This designer request ID was already used for different input.', 409)
    return receipt


@transaction.atomic
def _commit(session, state, base_revision, command_id, digest, reply, authorize=None):
    # Match all existing scene/cart writes: cart lock first, then scene lock.
    from shopping.services import lock_scene_cart
    if authorize:
        authorize()
    lock_scene_cart(session)
    scene = scene_for_session(session, state.room['roomId'])
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    previous = _replay(scene, command_id, digest)
    if previous:
        return previous, True
    if scene.revision != base_revision:
        raise SceneError('revision_conflict', 'The room changed while the designer was working. Review it and try again.', 409, scene.revision)
    commands = state.commands if reply.apply else []
    if commands:
        snapshot = apply_scene_commands(session, base_revision, command_id, commands, state.room['roomId'])
        receipt = SceneCommandReceipt.objects.get(scene=scene, command_id=command_id)
    else:
        snapshot = serialize(scene)
        receipt = SceneCommandReceipt(scene=scene, command_id=command_id, payload_hash=digest)
    snapshot['_designer'] = {'requestHash': digest, 'message': str(reply.message)[:500],
                             'appliedCount': len(commands), 'geometryValidated': bool(commands),
                             'visualStatus': 'pending' if commands else 'not_requested', 'toolTrace': state.trace}
    receipt.response = snapshot
    receipt.save()
    return receipt, False


def _capture(session, room_id, revision, request_id, camera):
    requested = request_scene_capture(session, revision, request_id, width=960, height=720, room_id=room_id, camera=camera)
    if not requested.get('ok'):
        return requested
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        image = read_scene_capture(session, requested['captureId'], include_image=True, room_id=room_id)
        if image.get('status') in ('ready', 'failed') or not image.get('ok'):
            return image
        time.sleep(.2)
    return {**requested, 'status': 'pending'}


def validate_payload(payload):
    required = {'text', 'requestId', 'baseRevision'}
    if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - {'selectedId', 'camera'}:
        raise SceneError('validation', 'Provide text, requestId, baseRevision and optional selectedId/camera.')
    if not isinstance(payload['text'], str) or not payload['text'].strip() or len(payload['text']) > 1000:
        raise SceneError('validation', 'Use a layout request between 1 and 1000 characters.')
    try:
        request_id = str(uuid.UUID(payload['requestId']))
    except (ValueError, TypeError, AttributeError):
        raise SceneError('validation', 'requestId must be a UUID.')
    validate_revision(payload['baseRevision'])
    if payload.get('selectedId') is not None and not isinstance(payload['selectedId'], str):
        raise SceneError('validation', 'selectedId must be an object ID or null.')
    try:
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True, allow_nan=False).encode()).hexdigest()
    except (ValueError, TypeError):
        raise SceneError('validation', 'Designer input must contain finite JSON values.')
    return request_id, digest


def design(session, room_id, payload, planner=None, verifier=None):
    request_id, digest = validate_payload(payload)
    command_id = 'designer:' + request_id
    scene = scene_for_session(session, room_id)
    previous = _replay(scene, command_id, digest)
    if previous:
        return _response(previous)
    if scene.revision != payload['baseRevision']:
        raise SceneError('revision_conflict', 'The room changed. Reload before asking the designer.', 409, scene.revision)
    snapshot = serialize(scene)
    camera = payload.get('camera')
    if camera is not None:
        capture_options({'view': 'perspective', 'camera': camera}, snapshot['room'])
    state = DesignState(snapshot, request_id, payload.get('selectedId'), camera)
    try:
        reply = (planner or designer_agent.plan)(state, payload['text'])
    except SceneError:
        raise
    except Exception:
        # Model/provider exceptions can contain request details; never relay them.
        raise SceneError('agent_unavailable', 'The designer could not finish. Your layout was not changed. Try again.', 503) from None
    receipt, replayed = _commit(session, state, payload['baseRevision'], command_id, digest, reply)
    if replayed or not receipt.response['_designer']['appliedCount']:
        return _response(receipt)
    report = receipt.response['_designer']
    try:
        capture = _capture(session, room_id, receipt.response['revision'], request_id + ':after', state.review_camera())
        report['captureId'] = capture.get('captureId')
        if capture.get('status') == 'ready' and capture.get('revision') == receipt.response['revision']:
            # The model receives the actual image, not its authenticated URL as text.
            state.snapshot['revision'] = receipt.response['revision']
            report['visualNote'] = (verifier or designer_agent.verify)(payload['text'], state.inspect(), capture)
            report['visualStatus'] = 'reviewed'
        else:
            report['visualStatus'] = 'unavailable'
            report['visualNote'] = 'Layout saved and geometry checked. Visual review needs the room open and a fresh capture.'
    except Exception:
        report['visualStatus'] = 'unavailable'
        report['visualNote'] = 'Layout saved and geometry checked. Visual review did not finish.'
    receipt.response['_designer'] = report
    receipt.save(update_fields=['response'])
    return _response(receipt)
