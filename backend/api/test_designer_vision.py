import copy
import math
import uuid
from types import SimpleNamespace

from django.test import TestCase

from shopping.models import CartItem, ShoppingSession
from .capture_service import claim_capture, complete_capture, enqueue_capture
from .designer_geometry import DesignState
from .designer_vision import project_objects, read_view, request_view
from .models import SceneCapture, SceneCommandReceipt
from .scene_service import SceneError, apply_scene_commands, scene_for_session, serialize
from .test_engine import png


class DesignerVisionTests(TestCase):
    def setUp(self):
        self.session = 'designer-vision'
        self.request_id = str(uuid.uuid4())
        self.table = {'instanceId': 'table-one', 'productId': 'test-table',
                      'pose': {'xCm': 230, 'zCm': 230, 'yawRad': 0}}
        apply_scene_commands(self.session, 0, 'seed', [{'type': 'add', 'instance': self.table}])

    def state(self, room='demo-room'):
        return DesignState(serialize(scene_for_session(self.session, room)), self.request_id)

    def test_accepted_capture_is_frozen_before_staged_edits_and_png_is_exact(self):
        state = self.state()
        state.relative('test-chair', 'table-one', 'right', 30)
        pending = request_view(state, self.session, 'before', 'top')
        self.assertEqual(pending['status'], 'pending')
        self.assertFalse(pending['preview'])
        self.assertEqual(pending['snapshotKind'], 'accepted')
        self.assertNotIn('imageDataUrl', pending)
        worker = claim_capture(self.session)['job']
        self.assertEqual(worker['snapshot']['instances'], [self.table])
        self.assertEqual(worker['revision'], 1)
        self.assertEqual([o['referenceId'] for o in pending['objectProjection']['objects']], ['table-one'])
        apply_scene_commands(self.session, 1, 'later-edit', [{'type': 'remove', 'instanceId': 'table-one'}])
        data_url = png(960, 720)
        complete_capture(self.session, pending['captureId'], {'leaseToken': worker['leaseToken'], 'imageDataUrl': data_url})
        ready = read_view(self.session, 'demo-room', pending['captureId'])
        self.assertEqual(ready['imageDataUrl'], data_url)
        self.assertEqual(ready['revision'], 1)
        self.assertEqual(ready['objectProjection'], pending['objectProjection'])
        self.assertEqual(ready['geometryRevision'], state.snapshot['geometryRevision'])

    def test_preview_never_mutates_layout_cart_or_command_receipts(self):
        shopping = ShoppingSession.objects.create(token_hash='vision-test', scene_key=self.session)
        CartItem.objects.create(shopping=shopping, room_id='demo-room', instance_id='table-one', product_id='test-table')
        before = serialize(scene_for_session(self.session))
        before_cart = list(CartItem.objects.values())
        receipt_count = SceneCommandReceipt.objects.count()
        state = self.state()
        staged = state.relative('test-chair', 'table-one', 'right', 30)
        # A modified in-memory product record must not affect captured metadata.
        state.products['test-chair']['name'] = 'invented-name'
        preview = request_view(state, self.session, 'preview', 'top', preview=True)
        self.assertTrue(preview['preview'])
        self.assertEqual(preview['snapshotKind'], 'staged_preview')
        self.assertEqual(preview['acceptedRevision'], 1)
        self.assertEqual(len(preview['previewHash']), 64)
        worker = claim_capture(self.session)['job']
        self.assertEqual(len(worker['snapshot']['instances']), 2)
        self.assertEqual(worker['snapshot']['capturePreview']['acceptedRevision'], 1)
        self.assertNotIn('invented-name', str(worker['snapshot']['products']))
        self.assertIn(staged['object']['referenceId'], [o['referenceId'] for o in preview['objectProjection']['objects']])
        complete_capture(self.session, preview['captureId'], {'leaseToken': worker['leaseToken'], 'imageDataUrl': png(960, 720)})
        self.assertEqual(serialize(scene_for_session(self.session)), before)
        self.assertEqual(list(CartItem.objects.values()), before_cart)
        self.assertEqual(SceneCommandReceipt.objects.count(), receipt_count)

    def test_invalid_or_stale_preview_creates_no_capture(self):
        state = self.state()
        state.instances[0]['pose']['xCm'] = -100
        with self.assertRaises(SceneError) as invalid:
            request_view(state, self.session, 'invalid', 'top', preview=True)
        self.assertEqual(invalid.exception.code, 'placement')
        self.assertFalse(SceneCapture.objects.exists())
        state = self.state()
        apply_scene_commands(self.session, 1, 'later-edit', [{'type': 'remove', 'instanceId': 'table-one'}])
        with self.assertRaises(SceneError) as stale:
            request_view(state, self.session, 'stale', 'top', preview=True)
        self.assertEqual(stale.exception.code, 'revision_conflict')
        self.assertFalse(SceneCapture.objects.exists())

    def test_geometry_revision_and_retry_intent_are_bound(self):
        state = self.state()
        state.snapshot['geometryRevision'] = 'stale-room-geometry'
        with self.assertRaises(SceneError) as stale:
            request_view(state, self.session, 'bad-geometry', 'top')
        self.assertEqual(stale.exception.code, 'geometry_conflict')
        self.assertFalse(SceneCapture.objects.exists())
        state = self.state()
        first = request_view(state, self.session, 'same-preview', 'top', preview=True)
        self.assertEqual(request_view(state, self.session, 'same-preview', 'top', preview=True), first)
        state.relative('test-chair', 'table-one', 'right', 30)
        with self.assertRaises(SceneError) as changed:
            request_view(state, self.session, 'same-preview', 'top', preview=True)
        self.assertEqual(changed.exception.code, 'request_conflict')
        self.assertEqual(SceneCapture.objects.count(), 1)

    def test_capture_is_scoped_to_session_and_floor(self):
        state = self.state('london-skyscraper')
        first = request_view(state, self.session, 'lobby', 'top')
        self.assertEqual(first['representation'], 'spatial_plan')
        self.assertEqual(first['roomId'], 'london-skyscraper')
        for session, room in [('another-session', 'london-skyscraper'), (self.session, 'london-skyscraper-level-m00')]:
            with self.assertRaises(SceneError) as denied:
                read_view(session, room, first['captureId'])
            self.assertEqual(denied.exception.code, 'not_found')
        self.assertIsNone(claim_capture(self.session, 'london-skyscraper-level-m00')['job'])

    def test_target_camera_turns_in_place_and_uses_known_reference(self):
        state = self.state('london-skyscraper')
        staged = state.stage('test-chair', {'xCm': 1670, 'zCm': 500, 'yawRad': 0})
        camera_before = copy.deepcopy(state.camera)
        capture = request_view(state, self.session, 'target', target_id=staged['object']['referenceId'], preview=True)
        camera = capture['camera']
        for key in ('xCm', 'yCm', 'zCm', 'fovDeg'):
            self.assertEqual(camera[key], camera_before[key])
        self.assertEqual(state.camera, camera_before)
        self.assertAlmostEqual(camera['yawRad'], math.atan2(camera['xCm'] - 1670, camera['zCm'] - 500))
        self.assertEqual(capture['objectProjection']['occlusion'], 'unknown')
        chair = next(o for o in capture['objectProjection']['objects'] if o['referenceId'] == staged['object']['referenceId'])
        self.assertTrue(chair['intersectsImage'])
        self.assertLess(chair['boundsPixels']['minX'], 480)
        self.assertGreater(chair['boundsPixels']['maxX'], 480)
        with self.assertRaises(SceneError):
            request_view(state, self.session, 'unknown', target_id='foreign-chair')
        self.assertEqual(SceneCapture.objects.count(), 1)

    def test_http_capture_payload_cannot_supply_staged_geometry(self):
        with self.assertRaises(SceneError) as unsupported:
            enqueue_capture(self.session, {'requestId': 'untrusted-preview', 'baseRevision': 1,
                                           'view': 'top', 'preview_instances': []})
        self.assertEqual(unsupported.exception.code, 'validation')

    def test_off_centre_duplicate_name_mapping_is_not_mirrored_or_guessed_visible(self):
        snapshot = {'room': {'widthCm': 1000, 'depthCm': 1000}, 'products': [
            {'productId': 'same-product', 'name': 'Identical chair', 'widthCm': 40, 'depthCm': 80, 'heightCm': 100}],
            'instances': [
                {'instanceId': 'north-east', 'productId': 'same-product', 'pose': {'xCm': 800, 'zCm': 100, 'yawRad': math.pi / 2}},
                {'instanceId': 'south-west', 'productId': 'same-product', 'pose': {'xCm': 150, 'zCm': 850, 'yawRad': 0}}]}
        job = SimpleNamespace(snapshot=snapshot, camera=None, view='top', representation='spatial_plan', width=960, height=720)
        result = project_objects(job)
        north, south = result['objects']
        self.assertEqual(north['referenceId'], 'north-east')
        self.assertEqual(south['referenceId'], 'south-west')
        self.assertGreater(north['boundsPixels']['minX'], south['boundsPixels']['maxX'])
        self.assertLess(north['boundsPixels']['maxY'], south['boundsPixels']['minY'])
        # The known schematic transform is 0.59 px/cm and (185, 66) origin.
        self.assertEqual(north['boundsPixels'], {'minX': 633.4, 'maxX': 680.6, 'minY': 113.2, 'maxY': 136.8})
        self.assertEqual(result['occlusion'], 'unknown')
        self.assertNotIn('visibleIds', result)

    def test_projection_reports_behind_camera_and_unknown_obstacle_height(self):
        state = self.state()
        snapshot = copy.deepcopy(state.snapshot)
        snapshot['room']['spatial'] = {'obstacles': [{'obstacleId': 'wall', 'label': 'Wall', 'widthCm': 100,
            'depthCm': 20, 'xCm': 230, 'zCm': 100, 'yawRad': 0}]}
        job = SimpleNamespace(snapshot=snapshot, view='perspective', representation='photographic', width=960, height=720,
                              camera={'kind': 'firstPerson', 'xCm': 230, 'yCm': 160, 'zCm': 50, 'yawRad': 0, 'pitchRad': 0, 'fovDeg': 60})
        result = project_objects(job)
        self.assertEqual(result['objects'][0]['projectionStatus'], 'clipped_depth_range')
        self.assertEqual(result['objects'][1]['projectionStatus'], 'unknown_height')
        self.assertTrue(all('boundsPixels' not in o for o in result['objects']))

    def test_perspective_projection_matches_installed_playcanvas_for_off_centre_rotated_box(self):
        # Compared with installed PlayCanvas Camera.worldToScreen on 2026-09-20:
        # eight yaw/pitch/rotation combinations matched within 0.000498 pixels.
        # This deliberately clips the RIGHT image edge; a mirrored projection
        # or wrong pitch/yaw multiplication cannot pass a symmetric-centre test.
        job = SimpleNamespace(view='perspective', representation='photographic', width=960, height=720,
            camera={'kind': 'firstPerson', 'xCm': 315, 'yCm': 168, 'zCm': 460, 'yawRad': .37, 'pitchRad': -.6, 'fovDeg': 63},
            snapshot={'room': {'widthCm': 1000, 'depthCm': 1000},
                'products': [{'productId': 'p', 'name': 'off-centre box', 'widthCm': 63, 'depthCm': 117, 'heightCm': 83}],
                'instances': [{'instanceId': 'object', 'productId': 'p', 'pose': {'xCm': 511, 'zCm': 73, 'yawRad': .71}}]})
        projected = project_objects(job)['objects'][0]
        self.assertEqual(projected['boundsPixels'], {'minX': 913.039, 'maxX': 1352.352, 'minY': 135.271, 'maxY': 385.221})
        self.assertTrue(projected['intersectsImage'])
        self.assertFalse(projected['fullyInImage'])

    def test_failed_capture_is_not_an_image(self):
        pending = request_view(self.state(), self.session, 'failed', 'top')
        worker = claim_capture(self.session)['job']
        complete_capture(self.session, pending['captureId'], {'leaseToken': worker['leaseToken'],
            'error': {'code': 'webgl', 'message': 'No renderer.'}})
        result = read_view(self.session, 'demo-room', pending['captureId'])
        self.assertFalse(result['ok'])
        self.assertEqual(result['status'], 'failed')
        self.assertNotIn('imageDataUrl', result)
