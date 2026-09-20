"""Durable designer acceptance: provider/renderer doubles, real persisted layouts."""
import copy
import json
import os
import uuid
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import Client, TransactionTestCase
from django.utils import timezone

from shopping.identity import COOKIE, digest
from shopping.models import ShoppingSession

from . import designer_jobs as jobs
from .catalogue_products import catalogue_product
from .models import SceneCommandReceipt, SceneDesignJob
from .scene_service import SceneError, apply_scene_commands, scene_for_session
from .test_engine import png


CHAIR = 'ikea-403.608.74'
TABLE = 'ikea-702.211.42'


def final_reply(apply=True, message='Chair is beside the table.'):
    return SimpleNamespace(status='completed', output=[], output_text=json.dumps({'apply': apply, 'message': message}))


def tool_reply(name, arguments):
    return SimpleNamespace(status='completed', output=[SimpleNamespace(
        type='function_call', name=name, arguments=json.dumps(arguments), call_id='tool-call')], output_text='')


class DesignerJobAcceptanceTests(TransactionTestCase):
    def setUp(self):
        self.session, self.room = 'designer-job-owner', 'demo-room'
        self.table = {'instanceId': 'table-one', 'productId': TABLE, 'product': catalogue_product(TABLE),
                      'pose': {'xCm': 230, 'zCm': 230, 'yawRad': 0}}
        apply_scene_commands(self.session, 0, 'seed', [{'type': 'add', 'instance': self.table}], self.room)
        self.payload = {'text': 'Place a chair 30 cm right of the table',
                        'requestId': str(uuid.uuid4()), 'baseRevision': 1}
        self.images, self.image_requests, self.provider_inputs = {}, [], []
        self.client = Mock()
        self.client.responses.create.side_effect = self.create_response
        self.client.responses.retrieve.return_value = final_reply()
        provider = Mock()
        provider.return_value.__enter__ = Mock(return_value=self.client)
        provider.return_value.__exit__ = Mock(return_value=False)
        for patcher in [patch.dict(os.environ, {'OPENAI_API_KEY': 'test-only-not-a-credential'}),
                        patch('api.designer_jobs.OpenAI', provider),
                        patch('api.designer_jobs.request_view', side_effect=self.request_view),
                        patch('api.designer_jobs.read_view', side_effect=self.read_view)]:
            patcher.start()
            self.addCleanup(patcher.stop)

    def create_response(self, **arguments):
        self.assertFalse(connection.in_atomic_block, 'Provider work must occur outside a database transaction.')
        self.provider_inputs.append(copy.deepcopy(arguments))
        return SimpleNamespace(id=f'response-{len(self.provider_inputs)}')

    def request_view(self, state, session, request_id, view='perspective', target_id=None, preview=False):
        self.assertFalse(connection.in_atomic_block, 'Capture waits must not hold scene locks.')
        self.assertEqual(session, self.session)
        identifier = str(uuid.uuid4())
        image = {'captureId': identifier, 'ok': True, 'status': 'ready',
                 'revision': state.snapshot['revision'], 'roomId': state.room['roomId'],
                 'geometryRevision': state.snapshot['geometryRevision'], 'view': view,
                 'preview': preview, 'snapshotKind': 'staged_preview' if preview else 'accepted',
                 'imageDataUrl': png(), 'objectProjection': {'occlusion': 'unknown', 'objects': []}}
        self.images[identifier] = image
        self.image_requests.append({'preview': preview, 'view': view, 'target': target_id,
                                    'revision': state.snapshot['revision'],
                                    'instances': copy.deepcopy(state.instances), 'captureId': identifier})
        return copy.deepcopy(image)

    def read_view(self, session, room_id, identifier):
        self.assertEqual((session, room_id), (self.session, self.room))
        return copy.deepcopy(self.images[identifier])

    def begin(self, **payload_updates):
        result = jobs.begin(self.session, self.room, {**self.payload, **payload_updates})
        self.job_id = result['jobId']
        return result

    def poll(self, reply=None, **kwargs):
        if reply is not None:
            self.client.responses.retrieve.return_value = reply
        return jobs.poll(self.session, self.room, self.job_id, **kwargs)

    def start_planning(self):
        self.begin()
        self.assertEqual(self.poll()['phase'], 'before')
        self.assertEqual(self.poll()['phase'], 'planning')

    def stage_chair(self):
        return self.poll(tool_reply('place_relative', {
            'product_id': CHAIR, 'reference_id': 'table-one', 'relation': 'right',
            'gap_cm': 30, 'frame': 'room', 'yaw_rad': 0, 'moving_id': None}))

    def reach_reviewed_preview(self):
        self.start_planning()
        self.stage_chair()
        self.assertEqual(self.poll(final_reply())['phase'], 'preview')
        self.assertEqual(self.poll()['phase'], 'planning')

    def guest_client(self):
        token = 'designer-tests-only-guest-token'
        shopping = ShoppingSession.objects.create(token_hash=digest(token), scene_key=self.session)
        client = Client(enforce_csrf_checks=True)
        client.cookies[COOKIE] = token
        self.assertEqual(client.get('/api/scene/').status_code, 200)
        return client, shopping

    def test_begin_replays_scoped_request_rejects_conflict_and_blocks_parallel_job(self):
        initial = self.begin()
        self.assertEqual(jobs.begin(self.session, self.room, self.payload), initial)
        self.assertEqual(SceneDesignJob.objects.count(), 1)
        with self.assertRaises(SceneError) as conflict:
            jobs.begin(self.session, self.room, {**self.payload, 'text': 'Remove the table'})
        self.assertEqual(conflict.exception.code, 'request_conflict')
        with self.assertRaises(SceneError) as busy:
            self.begin(requestId=str(uuid.uuid4()))
        self.assertEqual(busy.exception.code, 'designer_busy')
        self.client.responses.create.assert_not_called()

    def test_active_request_is_scoped_to_scene_and_omits_completed_requests(self):
        self.start_planning()
        scene = scene_for_session(self.session, self.room)
        self.assertEqual(jobs.active_request(scene), {'payload': self.payload, 'before': [self.table]})
        self.assertIsNone(jobs.active_request(scene_for_session('another-owner', self.room)))
        self.assertIsNone(jobs.active_request(scene_for_session(self.session, 'studio')))
        self.assertEqual(self.poll(final_reply(False, 'No edit needed.'))['status'], 'completed')
        self.assertIsNone(jobs.active_request(scene))

    def test_reload_resume_retains_original_undo_state_after_commit(self):
        self.reach_reviewed_preview()
        self.assertEqual(self.poll(final_reply())['phase'], 'after')
        saved = scene_for_session(self.session, self.room)
        job = SceneDesignJob.objects.get(pk=self.job_id)
        self.assertEqual(saved.revision, 2)
        self.assertEqual(len(job.data['snapshot']['instances']), 2)
        resumed = jobs.active_request(saved)
        self.assertEqual(resumed, {'payload': self.payload, 'before': [self.table]})
        self.assertEqual(resumed['payload']['baseRevision'], 1)
        # The original begin is replayable even though its revision is now old.
        replay = jobs.begin(self.session, self.room, resumed['payload'])
        self.assertEqual(replay['jobId'], self.job_id)
        self.assertEqual(replay['phase'], 'after')

    def test_http_scene_includes_only_its_own_active_designer_resume(self):
        guest, _ = self.guest_client()
        self.start_planning()
        response = guest.get('/api/scene/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['activeDesigner'], {'payload': self.payload, 'before': [self.table]})
        self.assertNotIn('activeDesigner', guest.get('/api/scene/?roomId=studio').json())
        self.assertNotIn('activeDesigner', Client().get('/api/scene/').json())
        self.poll(final_reply(False, 'No edit needed.'))
        self.assertNotIn('activeDesigner', guest.get('/api/scene/').json())

    def test_http_claim_during_reasoning_blocks_commit_and_guest_resume_access(self):
        guest, shopping = self.guest_client()
        headers = {'HTTP_X_CSRFTOKEN': guest.cookies['csrftoken'].value}
        begun = guest.post('/api/designer/', self.payload, content_type='application/json', **headers)
        self.assertEqual(begun.status_code, 200)
        self.job_id = begun.json()['jobId']
        self.poll()
        self.poll()
        self.stage_chair()
        self.poll(final_reply())
        self.poll()
        owner = get_user_model().objects.create_user(username='designer-claim-owner', email='designer-owner@example.test')
        def claim_while_model_finishes(*args, **kwargs):
            self.assertFalse(connection.in_atomic_block)
            ShoppingSession.objects.filter(pk=shopping.pk).update(owner=owner)
            return final_reply()
        self.client.responses.retrieve.side_effect = claim_while_model_finishes
        result = guest.post(f'/api/designer/{self.job_id}/', {}, content_type='application/json', **headers)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['status'], 'failed')
        self.assertEqual(result.json()['error']['code'], 'ownership_conflict')
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])
        self.assertFalse(SceneCommandReceipt.objects.filter(command_id='designer:'+self.payload['requestId']).exists())
        fresh_guest_scene = guest.get('/api/scene/').json()
        self.assertEqual(fresh_guest_scene['instances'], [])
        self.assertNotIn('activeDesigner', fresh_guest_scene)

    def test_poll_is_scoped_to_both_session_and_floor(self):
        self.begin()
        for session, room in [('other-session', self.room), (self.session, 'studio')]:
            with self.subTest(session=session, room=room), self.assertRaises(SceneError) as error:
                jobs.poll(session, room, self.job_id)
            self.assertEqual(error.exception.code, 'not_found')
        self.assertEqual(SceneDesignJob.objects.get(pk=self.job_id).phase, 'before')
        self.assertEqual(self.image_requests, [])

    def test_exclusive_lease_prevents_duplicate_work_and_expired_lease_resumes(self):
        self.begin()
        claimed, acquired = jobs.claim(self.session, self.room, self.job_id, None)
        self.assertTrue(acquired)
        duplicate, acquired_again = jobs.claim(self.session, self.room, self.job_id, None)
        self.assertFalse(acquired_again)
        self.assertEqual(duplicate.lease_token, claimed.lease_token)
        self.poll()
        self.assertEqual(self.image_requests, [])
        SceneDesignJob.objects.filter(pk=self.job_id).update(lease_until=timezone.now()-timedelta(seconds=1))
        self.poll()
        self.assertEqual(len(self.image_requests), 2)
        self.assertIsNone(SceneDesignJob.objects.get(pk=self.job_id).lease_token)

    def test_before_images_are_real_image_parts_and_provider_work_does_not_hold_locks(self):
        self.start_planning()
        content = self.provider_inputs[0]['input'][0]['content']
        image_parts = [part for part in content if part['type'] == 'input_image']
        self.assertEqual(len(image_parts), 2)
        self.assertTrue(all(part['image_url'].startswith('data:image/png;base64,') for part in image_parts))
        self.assertTrue(self.provider_inputs[0]['background'])
        self.assertEqual(self.provider_inputs[0]['reasoning'], {'effort': 'xhigh'})
        self.assertFalse(self.provider_inputs[0]['parallel_tool_calls'])
        self.assertEqual(scene_for_session(self.session, self.room).revision, 1)

    def test_pending_pre_capture_does_not_call_model_or_modify_scene(self):
        self.begin()
        self.poll()
        for capture in self.images.values():
            capture['status'] = 'rendering'
            capture.pop('imageDataUrl')
        self.assertEqual(self.poll()['phase'], 'before')
        self.client.responses.create.assert_not_called()
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])

    def test_pre_capture_failure_stops_before_model_and_preserves_layout(self):
        self.begin()
        self.poll()
        next(iter(self.images.values())).update(status='failed', ok=False)
        failed = self.poll()
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'capture_unavailable')
        self.client.responses.create.assert_not_called()
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])

    def test_stale_revision_after_planning_preserves_only_the_manual_edit(self):
        self.start_planning()
        self.stage_chair()
        apply_scene_commands(self.session, 1, 'manual', [{'type': 'setPose', 'instanceId': 'table-one',
                             'pose': {'xCm': 240, 'zCm': 230, 'yawRad': 0}}], self.room)
        failed = self.poll(final_reply())
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'revision_conflict')
        scene = scene_for_session(self.session, self.room)
        self.assertEqual(len(scene.instances), 1)
        self.assertEqual(scene.instances[0]['pose']['xCm'], 240)
        self.assertFalse(SceneCommandReceipt.objects.filter(command_id='designer:'+self.payload['requestId']).exists())

    def test_staged_preview_precedes_commit_and_result_replay_never_reexecutes(self):
        self.reach_reviewed_preview()
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])
        self.assertEqual(len(self.image_requests[-1]['instances']), 2)
        self.assertTrue(self.image_requests[-1]['preview'])
        preview_input = self.provider_inputs[-1]['input'][0]['content']
        self.assertTrue(any(part['type'] == 'input_image' for part in preview_input))
        self.assertEqual(self.poll(final_reply())['phase'], 'after')
        saved = scene_for_session(self.session, self.room)
        self.assertEqual(saved.revision, 2)
        self.assertEqual(len(saved.instances), 2)
        self.assertEqual(self.poll()['phase'], 'verifying')
        self.assertEqual(self.provider_inputs[-1]['tools'], [])
        complete = self.poll(final_reply(False, 'Both objects are visible.'))
        self.assertEqual(complete['status'], 'completed')
        self.assertEqual(complete['designer']['visualStatus'], 'reviewed')
        self.assertEqual(complete['scene']['revision'], 2)
        calls = (self.client.responses.create.call_count, self.client.responses.retrieve.call_count)
        self.assertEqual(self.poll(), complete)
        self.assertEqual(jobs.begin(self.session, self.room, self.payload), complete)
        self.assertEqual((self.client.responses.create.call_count, self.client.responses.retrieve.call_count), calls)

    def test_revised_preview_requires_another_image_before_save(self):
        self.reach_reviewed_preview()
        chair_id = SceneDesignJob.objects.get(pk=self.job_id).data['instances'][-1]['instanceId']
        self.poll(tool_reply('place_relative', {
            'product_id': CHAIR, 'reference_id': 'table-one', 'relation': 'right',
            'gap_cm': 50, 'frame': 'room', 'yaw_rad': 0, 'moving_id': chair_id}))
        self.assertEqual(self.poll(final_reply())['phase'], 'preview')
        self.assertEqual(scene_for_session(self.session, self.room).revision, 1)
        self.assertEqual(sum(c['preview'] for c in self.image_requests), 2)

    def test_failed_preview_does_not_save_a_successful_staged_placement(self):
        self.start_planning()
        self.stage_chair()
        self.assertEqual(self.poll(final_reply())['phase'], 'preview')
        self.images[self.image_requests[-1]['captureId']].update(status='failed', ok=False)
        failed = self.poll()
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'capture_unavailable')
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])
        self.assertFalse(SceneCommandReceipt.objects.filter(command_id='designer:'+self.payload['requestId']).exists())

    def test_mismatched_capture_revision_cannot_ground_a_commit(self):
        self.begin()
        self.poll()
        next(iter(self.images.values()))['revision'] = 0
        failed = self.poll()
        self.assertEqual(failed['error']['code'], 'revision_conflict')
        self.client.responses.create.assert_not_called()
        self.assertEqual(scene_for_session(self.session, self.room).revision, 1)

    def test_targeted_capture_tool_returns_pixels_before_the_next_model_turn(self):
        self.start_planning()
        capture_step = self.poll(tool_reply('capture_view', {
            'view': 'perspective', 'target_id': 'table-one', 'preview': False}))
        self.assertEqual(capture_step['phase'], 'tool_capture')
        self.assertEqual(self.client.responses.create.call_count, 1)
        self.assertEqual(self.image_requests[-1]['target'], 'table-one')
        self.assertEqual(self.poll()['phase'], 'planning')
        inputs = self.provider_inputs[-1]['input']
        self.assertEqual(inputs[0]['type'], 'function_call_output')
        self.assertEqual(inputs[0]['call_id'], 'tool-call')
        self.assertTrue(any(part['type'] == 'input_image' for part in inputs[1]['content']))
        self.assertEqual(scene_for_session(self.session, self.room).revision, 1)

    def test_clarification_discards_every_staged_edit(self):
        self.start_planning()
        self.stage_chair()
        result = self.poll(final_reply(False, 'Which second chair did you mean?'))
        self.assertEqual(result['status'], 'completed')
        self.assertEqual(result['designer']['appliedCount'], 0)
        self.assertEqual(result['scene']['revision'], 1)
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])

    def test_authorization_is_rechecked_after_reasoning_immediately_before_save(self):
        self.reach_reviewed_preview()
        def revoke_on_second_check():
            if authorization.call_count == 2:
                raise SceneError('forbidden', 'The room no longer belongs to this session.', 403)
        authorization = Mock(side_effect=revoke_on_second_check)
        failed = self.poll(final_reply(), authorize=authorization)
        self.assertEqual(authorization.call_count, 2)
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'forbidden')
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])

    def test_provider_exception_is_redacted_and_never_changes_layout(self):
        self.start_planning()
        self.client.responses.retrieve.side_effect = RuntimeError('private-provider-error-token')
        failed = self.poll()
        self.assertEqual(failed['status'], 'failed')
        self.assertEqual(failed['error']['code'], 'agent_unavailable')
        self.assertNotIn('private-provider-error-token', json.dumps(failed))
        self.assertEqual(scene_for_session(self.session, self.room).instances, [self.table])

    def test_post_capture_failure_reports_the_committed_layout(self):
        self.reach_reviewed_preview()
        with patch('api.designer_jobs.request_view', side_effect=RuntimeError('private-render-error')):
            completed = self.poll(final_reply())
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(completed['scene']['revision'], 2)
        self.assertEqual(completed['designer']['visualStatus'], 'unavailable')
        self.assertNotIn('private-render-error', json.dumps(completed))
        self.assertEqual(len(scene_for_session(self.session, self.room).instances), 2)

    def test_crash_after_commit_recovers_saved_receipt_after_lease_expiry(self):
        self.reach_reviewed_preview()
        with patch('api.designer_jobs.request_view', side_effect=SystemExit('simulate worker termination')):
            with self.assertRaises(SystemExit):
                self.poll(final_reply())
        self.assertEqual(scene_for_session(self.session, self.room).revision, 2)
        SceneDesignJob.objects.filter(pk=self.job_id).update(lease_until=timezone.now()-timedelta(seconds=1))
        recovered = self.poll()
        # Recovery may finish immediately or resume its bounded visual-review steps.
        for _ in range(2):
            if recovered['status'] != 'running':
                break
            self.assertIn(recovered['phase'], ('after', 'verifying'))
            recovered = self.poll(final_reply(False, 'Saved arrangement remains visible.'))
        self.assertEqual(recovered['status'], 'completed')
        self.assertEqual(recovered['scene']['revision'], 2)
        self.assertEqual(len(recovered['scene']['instances']), 2)

    def test_removing_selected_object_still_allows_post_save_visual_review(self):
        self.payload.update(text='Remove the selected table', selectedId='table-one')
        self.start_planning()
        self.poll(tool_reply('remove_object', {'reference_id': 'selected'}))
        self.assertEqual(self.poll(final_reply())['phase'], 'preview')
        self.assertEqual(self.poll()['phase'], 'planning')
        self.assertEqual(self.poll(final_reply())['phase'], 'after')
        self.assertEqual(scene_for_session(self.session, self.room).instances, [])
        self.assertEqual(self.poll()['phase'], 'verifying')
        complete = self.poll(final_reply(False, 'The selected table is removed.'))
        self.assertEqual(complete['designer']['visualStatus'], 'reviewed')
