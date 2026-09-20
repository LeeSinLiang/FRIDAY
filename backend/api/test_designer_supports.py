"""Designer tools use the same reviewed attachments as persisted scene commands."""
import asyncio
import copy
import json
import math

from agents.tool_context import ToolContext
from django.test import TestCase

from . import designer_agent
from .designer_context import inspect_context, measure
from .designer_geometry import DesignState
from .scene_service import SceneError, apply_scene_commands, scene_for_session, serialize


class DesignerSupportTests(TestCase):
    def state(self, request='supports', **kwargs):
        return DesignState(serialize(scene_for_session('designer-supports', 'empty-room')), request, **kwargs)

    def floor(self, state, product, x=260, z=220, yaw=0):
        return state.stage(product, {'xCm': x, 'zCm': z, 'yawRad': yaw})['object']

    def target(self, state, parent, target_id='top'):
        return next(t for t in state.support_references()
                    if t['parentInstanceId'] == parent['referenceId'] and t['targetId'] == target_id)

    def on(self, state, product, parent, target_id='top', relation='on', x=None, z=None, yaw=0, moving_id=None):
        target = self.target(state, parent, target_id)
        return state.supported(product, target['referenceId'], relation, target['profileRevision'], x, z, yaw, moving_id)['object']

    def invoke(self, tool, state, arguments):
        ctx = ToolContext(context=state, tool_name=tool.name, tool_call_id='support-test', tool_arguments='{}')
        result = asyncio.run(tool.on_invoke_tool(ctx, json.dumps(arguments)))
        return json.loads(result) if isinstance(result, str) else result

    def assert_rejected_unchanged(self, state, code, callback):
        before = copy.deepcopy((state.instances, state.commands, state.snapshot))
        with self.assertRaises(SceneError) as error:
            callback()
        self.assertEqual(error.exception.code, code)
        self.assertEqual((state.instances, state.commands, state.snapshot), before)

    def test_staged_desk_monitor_context_has_reviewed_targets_and_resolved_height(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk')
        monitor = self.on(state, 'pc-workspace-display', desk, x=25, z=-10)
        self.assertEqual(monitor['pose'], {'xCm': 285, 'zCm': 210, 'yawRad': 0, 'yCm': 75})
        self.assertEqual(monitor['boundsCm']['minY'], 75)
        self.assertEqual(monitor['boundsCm']['maxY'], 117)
        context = inspect_context(state)
        objects = {o['referenceId']: o for o in context['objects']}
        self.assertEqual(objects[monitor['referenceId']]['positionCm'], [285, 75, 210])
        self.assertEqual(objects[monitor['referenceId']]['parentReferenceId'], desk['referenceId'])
        self.assertEqual(objects[desk['referenceId']]['children'], [monitor['referenceId']])
        target = objects[desk['referenceId']]['supportSurfaces']['targets'][0]
        self.assertEqual(target['referenceId'], desk['referenceId'] + '/top')
        self.assertEqual(target['worldPose']['yCm'], 75)
        self.assertEqual(target['coordinateSpace'], 'parent_local')
        self.assertEqual(objects[desk['referenceId']]['cavities']['status'], 'unavailable')
        self.assertEqual(objects[monitor['referenceId']]['appearance']['meshMaterials']['status'], 'unavailable')
        context['supportReferences'][0]['worldPose']['yCm'] = -999
        self.assertEqual(self.target(state, desk)['worldPose']['yCm'], 75)

    def test_off_centre_monitor_inherits_parent_translation_and_quarter_turn_then_reloads(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk')
        monitor = self.on(state, 'pc-workspace-display', desk, x=25, z=-10, yaw=.2)
        state.stage('pc-workspace-desk', {'xCm': 300, 'zCm': 240, 'yawRad': math.pi/2}, desk['referenceId'])
        moved = state.object(monitor['referenceId'])
        self.assertAlmostEqual(moved['pose']['xCm'], 290)
        self.assertAlmostEqual(moved['pose']['zCm'], 215)
        self.assertAlmostEqual(moved['pose']['yawRad'], math.pi/2+.2)
        self.assertEqual(moved['pose']['yCm'], 75)
        saved = apply_scene_commands('designer-supports', 0, 'save-supports', state.commands, 'empty-room')
        self.assertEqual(saved['instances'], state.instances)
        reloaded = self.state('reload')
        self.assertEqual(reloaded.object(monitor['referenceId'])['pose'], moved['pose'])
        self.assertEqual(reloaded.object(monitor['referenceId'])['attachment'], moved['attachment'])
        self.assertEqual(reloaded.object(desk['referenceId'])['children'], [monitor['referenceId']])

    def test_moving_child_preserves_support_and_commit_replays_local_pose(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk', yaw=math.pi/2)
        monitor = self.on(state, 'pc-workspace-display', desk)
        moved = state.stage('pc-workspace-display', {'xCm': 250, 'zCm': 200, 'yawRad': math.pi/2}, monitor['referenceId'])['object']
        local = moved['attachment']['localPose']
        self.assertAlmostEqual(local['xCm'], 20)
        self.assertAlmostEqual(local['zCm'], -10)
        self.assertAlmostEqual(local['yawRad'], 0)
        self.assertEqual(moved['pose']['yCm'], 75)
        self.assertNotIn('attachment', state.commands[-1])
        saved = apply_scene_commands('designer-supports', 0, 'child-move', state.commands, 'empty-room')
        self.assertEqual(saved['instances'], state.instances)

    def test_cabinet_same_xz_different_shelves_have_real_vertical_clearance(self):
        state = self.state()
        cabinet = self.floor(state, 'support-demo-cabinet')
        lower = self.on(state, 'support-demo-box', cabinet, 'lower', 'inside', -15, 2)
        middle = self.on(state, 'support-demo-box', cabinet, 'upper', 'inside', -15, 2)
        self.assertEqual(lower['pose']['yCm'], 3)
        self.assertEqual(middle['pose']['yCm'], 51.5)
        context = inspect_context(state)
        self.assertEqual(len(context['objects'][0]['cavities']['targets']), 2)
        result = measure(state, lower['referenceId'], middle['referenceId'])
        self.assertTrue(result['overlap'])
        self.assertFalse(result['boundingPrismOverlap'])
        self.assertEqual(result['centerDistanceCm'], 0)
        self.assertEqual(result['centerDistance3dCm'], 48.5)
        height = lower['dimensionsCm']['heightCm']
        self.assertEqual(result['vertical']['clearanceCm'], 48.5-height)
        self.assertEqual(result['boundingPrismDistanceCm'], 48.5-height)
        self.assertEqual(result['vertical']['intervalsCm']['b']['minY'], 51.5)

    def test_monitor_touches_desk_bounding_prism_without_volume_overlap(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk')
        monitor = self.on(state, 'pc-workspace-display', desk)
        result = measure(state, desk['referenceId'], monitor['referenceId'])
        self.assertTrue(result['overlap'])
        self.assertFalse(result['boundingPrismOverlap'])
        self.assertEqual(result['vertical']['clearanceCm'], 0)
        self.assertEqual(result['vertical']['overlapDepthCm'], 0)
        self.assertEqual(result['centerDistance3dCm'], 58.5)

    def test_stale_unknown_or_wrong_kind_target_cannot_change_scene(self):
        state = self.state()
        cabinet = self.floor(state, 'support-demo-cabinet')
        target = self.target(state, cabinet, 'upper')
        for ref, relation, revision, code in [
            (target['referenceId'], 'on', target['profileRevision'], 'unsupported_target'),
            (target['referenceId'], 'inside', 'obsolete', 'stale_profile'),
            ('other-cabinet/upper', 'inside', target['profileRevision'], 'unsupported_target'),
        ]:
            with self.subTest(code=code):
                self.assert_rejected_unchanged(state, code, lambda: state.supported('support-demo-box', ref, relation, revision))
        self.assert_rejected_unchanged(state, 'validation', lambda: state.supported(
            'support-demo-box', target['referenceId'], 'inside', target['profileRevision'], local_x_cm=2))

    def test_overhang_compartment_headroom_and_sibling_collision_are_rejected(self):
        state = self.state()
        cabinet = self.floor(state, 'support-demo-cabinet')
        self.assert_rejected_unchanged(state, 'support_overhang', lambda: self.on(
            state, 'support-demo-box', cabinet, 'upper', 'inside', 40, 2))
        self.assert_rejected_unchanged(state, 'outside_compartment', lambda: self.on(
            state, 'pc-workspace-lamp', cabinet, 'upper', 'inside'))
        self.on(state, 'support-demo-box', cabinet, 'upper', 'inside', -15, 2)
        self.assert_rejected_unchanged(state, 'placement', lambda: self.on(
            state, 'support-demo-box', cabinet, 'upper', 'inside', -15, 2))

    def test_unreviewed_model_has_no_support_even_when_named_table(self):
        state = self.state()
        table = self.floor(state, 'test-table')
        self.assertEqual(state.support_references(), [])
        self.assertEqual(inspect_context(state)['objects'][0]['supportSurfaces']['status'], 'unavailable')
        self.assert_rejected_unchanged(state, 'unsupported_target', lambda: state.supported(
            'support-demo-lamp', table['referenceId']+'/top', 'on', '1'))

    def test_parent_delete_and_assembly_move_are_atomic_then_children_can_be_removed(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk')
        monitor = self.on(state, 'pc-workspace-display', desk, x=25, z=-10)
        self.assert_rejected_unchanged(state, 'has_children', lambda: state.remove(desk['referenceId']))
        self.assert_rejected_unchanged(state, 'placement', lambda: state.stage(
            'pc-workspace-desk', {'xCm': 10, 'zCm': 10, 'yawRad': .4}, desk['referenceId']))
        state.remove(monitor['referenceId'])
        state.remove(desk['referenceId'])
        saved = apply_scene_commands('designer-supports', 0, 'remove-assembly', state.commands, 'empty-room')
        self.assertEqual(saved['instances'], [])

    def test_explicit_floor_tool_detaches_and_can_be_reattached_without_new_id(self):
        state = self.state()
        desk = self.floor(state, 'pc-workspace-desk')
        monitor = self.on(state, 'pc-workspace-display', desk)
        result = self.invoke(designer_agent.place_on_floor, state, {
            'product_id': 'pc-workspace-display', 'x_cm': 100, 'z_cm': 100, 'yaw_rad': 0, 'moving_id': monitor['referenceId']})
        self.assertTrue(result['ok'])
        self.assertNotIn('attachment', result['object'])
        self.assertEqual(result['object']['pose'].get('yCm', 0), 0)
        self.assertIsNone(state.commands[-1]['attachment'])
        self.on(state, 'pc-workspace-display', desk, moving_id=monitor['referenceId'])
        self.assertEqual(len(state.instances), 2)
        self.assertEqual(state.commands[-1]['attachment']['parentInstanceId'], desk['referenceId'])
        saved = apply_scene_commands('designer-supports', 0, 'reattach', state.commands, 'empty-room')
        self.assertEqual(saved['instances'], state.instances)

    def test_support_tool_strict_schema_has_no_height_or_owner_override_and_structured_failure(self):
        state = self.state()
        schema = designer_agent.place_supported.params_json_schema
        self.assertFalse(schema['additionalProperties'])
        for name in ('y_cm', 'local_y_cm', 'session', 'session_key', 'room_id'):
            self.assertNotIn(name, schema['properties'])
        result = self.invoke(designer_agent.place_supported, state, {
            'product_id': 'support-demo-box', 'target_reference_id': 'unknown/upper', 'relation': 'inside',
            'profile_revision': '1', 'local_x_cm': None, 'local_z_cm': None, 'local_yaw_rad': 0, 'moving_id': None})
        self.assertFalse(result['ok'])
        self.assertEqual(result['error']['code'], 'unsupported_target')
        self.assertEqual(state.commands, [])
        self.assertEqual(state.trace[-1]['tool'], 'place_supported')

    def test_model_search_discovers_fixture_cabinet_box_and_catalogue_monitor(self):
        state = self.state()
        for query, expected in [('cabinet', 'support-demo-cabinet'), ('box', 'support-demo-box'),
                                ('display', 'pc-workspace-display'), ('desk', 'pc-workspace-desk')]:
            with self.subTest(query=query):
                result = self.invoke(designer_agent.search_models, state, {'query': query})
                self.assertIn(expected, [p['productId'] for p in result['products']])
                self.assertTrue(all(p.get('modelUrl') for p in result['products']))
                self.assertLessEqual(len(result['products']), 12)

    def test_review_camera_includes_attached_children_when_only_parent_moves(self):
        camera = {'kind': 'firstPerson', 'xCm': 100, 'yCm': 170, 'zCm': 420, 'yawRad': 0, 'pitchRad': 0, 'fovDeg': 65}
        state = self.state(camera=camera)
        desk = self.floor(state, 'pc-workspace-desk')
        self.on(state, 'pc-workspace-display', desk, x=25, z=-10)
        apply_scene_commands('designer-supports', 0, 'seed-camera', state.commands, 'empty-room')
        state = self.state('move-camera', camera=camera)
        state.stage('pc-workspace-desk', {'xCm': 300, 'zCm': 240, 'yawRad': math.pi/2}, desk['referenceId'])
        review = state.review_camera()
        # Parent centre (300,37.5,240), monitor centre (290,96,215).
        self.assertAlmostEqual(review['yawRad'], math.atan2(-195, 192.5))
        self.assertAlmostEqual(review['pitchRad'], math.atan2(66.75-170, math.hypot(195, -192.5)))
        self.assertEqual([review[k] for k in ('xCm', 'yCm', 'zCm')], [100, 170, 420])
