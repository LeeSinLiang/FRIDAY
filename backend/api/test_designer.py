import asyncio
import json
import math
import uuid
from unittest.mock import AsyncMock, Mock, patch

from agents.tool_context import ToolContext
from django.core.cache import cache
from django.test import Client, TestCase

from . import designer_agent
from .designer_agent import PlanReply
from .designer_geometry import DesignState
from .designer_service import design
from .models import SceneCommandReceipt
from .scene_service import SceneError, apply_scene_commands, scene_for_session, serialize
from .test_engine import png


class DesignerTests(TestCase):
    def setUp(self):
        cache.clear()
        self.session = 'designer-test'
        self.table = {'instanceId': 'table-one', 'productId': 'test-table',
                      'pose': {'xCm': 230, 'zCm': 230, 'yawRad': 0}}
        apply_scene_commands(self.session, 0, 'seed', [{'type': 'add', 'instance': self.table}])
        self.payload = {'text': 'Place a chair 30 cm right of the table', 'requestId': str(uuid.uuid4()), 'baseRevision': 1}

    def state(self, room='demo-room', session=None, **kwargs):
        return DesignState(serialize(scene_for_session(session or self.session, room)), self.payload['requestId'], **kwargs)

    def planner(self, state, text):
        state.relative('test-chair', 'table-one', 'right', 30)
        return PlanReply(apply=True, message='Chair staged 30 cm to the table’s right in room axes.')

    def test_rotated_reference_and_view_frames_use_edge_clearance(self):
        state = self.state()
        self.assertEqual(state.relative_pose('test-chair', 'table-one', 'right', 30), {'xCm': 355, 'zCm': 230, 'yawRad': 0})
        state.instances[0]['pose']['yawRad'] = math.pi/2
        pose = state.relative_pose('test-chair', 'table-one', 'right', 30, 'reference', math.pi/2)
        self.assertAlmostEqual(pose['xCm'], 230)
        self.assertAlmostEqual(pose['zCm'], 105)
        state.camera = {'yawRad': math.pi/2}
        view = state.relative_pose('test-chair', 'table-one', 'front', 30, 'view')
        self.assertAlmostEqual(view['xCm'], 135)
        self.assertAlmostEqual(view['zCm'], 230)

    def test_reference_ids_selection_self_exclusion_and_duplicate_names(self):
        state = self.state(selected_id='table-one')
        self.assertEqual(state.object('selected')['referenceId'], 'table-one')
        state.stage('test-table', {'xCm': 235, 'zCm': 230, 'yawRad': .1}, 'table-one')
        state.stage('test-table', {'xCm': 460, 'zCm': 230, 'yawRad': 0})
        self.assertEqual(len(state.inspect()['objects']), 2)
        self.assertEqual(len({o['referenceId'] for o in state.inspect()['objects']}), 2)
        for ref in ['Stone coffee table', 'missing']:
            with self.assertRaises(SceneError):
                state.object(ref)
        with self.assertRaises(SceneError):
            state.relative('test-table', 'selected', 'right', 30, moving_id='table-one')
        with self.assertRaises(SceneError):
            self.state(selected_id='foreign-object')

    def test_real_skyscraper_slanted_boundary_and_floor_isolation(self):
        state = self.state('london-skyscraper')
        state.stage('test-chair', {'xCm': 1670, 'zCm': 500, 'yawRad': 0})
        with self.assertRaises(SceneError) as error:
            state.stage('test-chair', {'xCm': 1870, 'zCm': 500, 'yawRad': 0})
        self.assertEqual(error.exception.details['issues'][0]['code'], 'unknown_area')
        self.assertEqual(len(state.commands), 1)
        for isolated in [self.state('london-skyscraper-level-m00'), self.state(session='other-session')]:
            with self.assertRaises(SceneError):
                isolated.object('table-one')

    def test_candidate_search_does_not_place_furniture_over_camera_and_camera_aims_at_target(self):
        camera = {'kind': 'firstPerson', 'xCm': 100, 'yCm': 170, 'zCm': 420, 'yawRad': 0, 'pitchRad': 0, 'fovDeg': 65}
        state = self.state(camera=camera)
        poses = state.candidates('test-chair')
        self.assertTrue(poses)
        for pose in poses:
            self.assertGreater(math.hypot(pose['xCm']-100, pose['zCm']-420), 70)
        self.planner(state, '')
        review = state.review_camera()
        self.assertEqual([review[k] for k in ('xCm','yCm','zCm')], [100,170,420])
        self.assertAlmostEqual(review['yawRad'], math.atan2(-255, 190))
        self.assertLess(review['pitchRad'], 0)
        self.assertEqual(camera['yawRad'], 0)

    def test_real_tool_schema_and_callback_return_structured_collision_failure(self):
        state = self.state()
        ctx = ToolContext(context=state, tool_name='place_relative', tool_call_id='test-call', tool_arguments='{}')
        result = asyncio.run(designer_agent.place_relative.on_invoke_tool(ctx, json.dumps({
            'product_id': 'test-chair', 'reference_id': 'missing', 'relation': 'right', 'gap_cm': 30,
            'frame': 'room', 'yaw_rad': 0, 'moving_id': None})))
        result = json.loads(result) if isinstance(result, str) else result
        self.assertFalse(result['ok'])
        self.assertEqual(result['error']['code'], 'unknown_reference')
        self.assertEqual(state.commands, [])
        for tool in designer_agent.TOOLS:
            self.assertNotIn('session', tool.params_json_schema.get('properties', {}))
            self.assertFalse(tool.params_json_schema['additionalProperties'])

    def test_atomic_save_replay_different_input_conflict_and_no_model_recall(self):
        planner = Mock(side_effect=self.planner)
        with patch('api.designer_service._capture', return_value={'status': 'pending'}):
            result = design(self.session, 'demo-room', self.payload, planner=planner)
        self.assertEqual(result['scene']['revision'], 2)
        self.assertEqual(result['designer']['appliedCount'], 1)
        self.assertEqual(result['designer']['visualStatus'], 'unavailable')
        replay = design(self.session, 'demo-room', self.payload, planner=planner)
        self.assertEqual(result, replay)
        self.assertEqual(planner.call_count, 1)
        with self.assertRaises(SceneError) as error:
            design(self.session, 'demo-room', {**self.payload, 'text': 'Remove everything'}, planner=planner)
        self.assertEqual(error.exception.code, 'request_conflict')

    def test_stale_before_planning_and_during_planning_leave_only_concurrent_edit(self):
        with self.assertRaises(SceneError):
            design(self.session, 'demo-room', {**self.payload, 'baseRevision': 0}, planner=Mock(side_effect=AssertionError))
        def concurrent(state, text):
            reply = self.planner(state, text)
            apply_scene_commands(self.session, 1, 'concurrent', [{'type': 'remove', 'instanceId': 'table-one'}])
            return reply
        with self.assertRaises(SceneError) as error:
            design(self.session, 'demo-room', self.payload, planner=concurrent)
        self.assertEqual(error.exception.code, 'revision_conflict')
        self.assertEqual(scene_for_session(self.session).instances, [])

    def test_clarification_discards_staged_edits_and_failed_commit_is_atomic(self):
        def clarify(state, text):
            self.planner(state, text)
            return PlanReply(apply=False, message='Which chair?')
        result = design(self.session, 'demo-room', self.payload, planner=clarify)
        self.assertEqual(result['scene']['instances'], [self.table])
        self.assertEqual(result['scene']['revision'], 1)
        def invalid(state, text):
            reply = self.planner(state, text)
            state.commands.append({'type': 'setPose', 'instanceId': 'table-one', 'pose': {'xCm': -1, 'zCm': 230, 'yawRad': 0}})
            return reply
        payload = {**self.payload, 'requestId': str(uuid.uuid4())}
        with self.assertRaises(SceneError):
            design(self.session, 'demo-room', payload, planner=invalid)
        self.assertEqual(scene_for_session(self.session).instances, [self.table])
        self.assertFalse(SceneCommandReceipt.objects.filter(command_id='designer:'+payload['requestId']).exists())

    def test_provider_error_changes_nothing_and_does_not_leak_details(self):
        with self.assertRaises(SceneError) as error:
            design(self.session, 'demo-room', self.payload, planner=Mock(side_effect=RuntimeError('secret-detail')))
        self.assertEqual(error.exception.code, 'agent_unavailable')
        self.assertNotIn('secret-detail', str(error.exception))
        self.assertEqual(scene_for_session(self.session).instances, [self.table])

    def test_capture_failure_cannot_undo_committed_layout(self):
        with patch('api.designer_service._capture', side_effect=RuntimeError('render failure')):
            result = design(self.session, 'demo-room', self.payload, planner=self.planner)
        self.assertEqual(result['scene']['revision'], 2)
        self.assertEqual(result['designer']['visualStatus'], 'unavailable')
        self.assertEqual(len(scene_for_session(self.session).instances), 2)

    def test_verification_receives_actual_png_and_saved_revision(self):
        capture = {'status': 'ready', 'revision': 2, 'imageDataUrl': png(), 'captureId': 'image'}
        verify = Mock(return_value='Both objects visible.')
        with patch('api.designer_service._capture', return_value=capture):
            result = design(self.session, 'demo-room', self.payload, planner=self.planner, verifier=verify)
        self.assertEqual(result['designer']['visualStatus'], 'reviewed')
        self.assertEqual(verify.call_args.args[1]['revision'], 2)
        self.assertEqual(verify.call_args.args[2]['imageDataUrl'], capture['imageDataUrl'])
        run = AsyncMock(return_value=Mock(final_output='Visible.'))
        with patch('api.designer_agent.model', return_value=('test-model', Mock(close=AsyncMock()))), patch('api.designer_agent.Runner.run', run):
            designer_agent.verify('request', {'revision': 2}, capture)
        content = run.call_args.args[1][0]['content']
        self.assertEqual(content[1]['type'], 'input_image')
        self.assertEqual(content[1]['image_url'], capture['imageDataUrl'])

    def test_http_csrf_and_session_scope(self):
        client = Client(enforce_csrf_checks=True)
        client.get('/api/scene/')
        payload = {**self.payload, 'baseRevision': 0}
        self.assertEqual(client.post('/api/designer/', payload, content_type='application/json').status_code, 403)
        with patch.dict('os.environ', {'OPENAI_API_KEY':'test-key'}):
            response = client.post('/api/designer/', payload, content_type='application/json', HTTP_X_CSRFTOKEN=client.cookies['csrftoken'].value)
        self.assertEqual(response.status_code, 200)
        from .models import SceneDesignJob
        self.assertEqual(SceneDesignJob.objects.get(pk=response.json()['jobId']).data['snapshot']['instances'], [])
