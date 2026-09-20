import copy
import json
import math
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import Client, TestCase, override_settings

from .engine_tools import request_scene_capture, try_place
from .models import SceneCommandReceipt, SceneLayout
from .room_context import prepared_room
from .scene_service import SceneError, covered_by_free_areas, footprint, validate_instances
from .test_engine import png


def scan_room():
    return {
        'roomId': 'test-scan', 'revision': 1, 'widthCm': 600, 'depthCm': 500, 'heightCm': 280,
        'scan': {'geometryRevision': 'fixed-v1', 'calibration': {'status': 'synthetic_demo', 'note': 'Unmeasured test fixture'},
                 'defaultCamera': {'kind': 'firstPerson', 'xCm': 300, 'yCm': 160, 'zCm': 300, 'yawRad': 0, 'pitchRad': 0, 'fovDeg': 60}},
        'spatial': {'freeAreas': [{'minXcm': 50, 'maxXcm': 550, 'minZcm': 50, 'maxZcm': 450}],
                    'obstacles': [{'obstacleId': 'fixed-sofa', 'label': 'scanned sofa', 'xCm': 200, 'zCm': 150, 'widthCm': 100, 'depthCm': 50, 'yawRad': math.pi / 4}]},
    }


class PreparedRoomTests(TestCase):
    def setUp(self):
        self.room = scan_room()
        self.loader = patch('api.room_context.prepared_room', side_effect=lambda room_id: copy.deepcopy(self.room)).start()
        self.addCleanup(patch.stopall)
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/scene/')
        self.token = self.client.cookies['csrftoken'].value
        self.item = {'instanceId': 'chair', 'productId': 'test-chair', 'pose': {'xCm': 400, 'zCm': 300, 'yawRad': 0}}

    def post(self, path, data, room_id='test-scan'):
        return self.client.post(f'{path}?roomId={room_id}', data, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def place(self, **extra):
        return self.post('/api/scene/placement/', {'commandId': 'place', 'baseRevision': 0, 'instance': self.item, **extra})

    def enqueue(self, **extra):
        return self.post('/api/scene/captures/', {'requestId': 'capture', 'baseRevision': 0, 'view': 'perspective', 'width': 256, 'height': 256, **extra})

    def test_explicit_scan_overrides_legacy_preset_cookie_without_crossing_layouts(self):
        self.client.cookies['friday_room'] = 'studio'
        legacy = self.client.get('/api/scene/').json()
        self.assertEqual(legacy['room']['roomId'], 'demo-studio')
        scan = self.client.get('/api/scene/?roomId=test-scan').json()
        self.assertEqual(scan['room']['roomId'], 'test-scan')
        self.assertEqual(scan['instances'], [])
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], legacy['instances'])
        self.assertEqual(set(SceneLayout.objects.values_list('room_id', flat=True)), {'demo-room', 'studio', 'test-scan'})

    def test_separate_room_layouts_preserve_legacy_and_command_receipts(self):
        command = {'baseRevision': 0, 'commandId': 'same-id', 'commands': [{'type': 'add', 'instance': self.item}]}
        self.assertEqual(self.post('/api/scene/commands/', command, 'demo-room').status_code, 200)
        scan = self.client.get('/api/scene/?roomId=test-scan').json()
        self.assertEqual(scan['instances'], [])
        self.assertEqual(scan['geometryRevision'], 'fixed-v1')
        self.assertEqual(scan['room']['spatial'], self.room['spatial'])
        self.assertEqual(self.post('/api/scene/commands/', command).status_code, 200)
        self.assertEqual(SceneLayout.objects.count(), 2)
        self.assertEqual(SceneCommandReceipt.objects.count(), 2)
        self.assertEqual(self.client.get('/api/scene/').json()['room']['roomId'], 'demo-room')
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [self.item])
        other = Client()
        self.assertEqual(other.get('/api/scene/?roomId=test-scan').json()['instances'], [])

    def test_fixed_obstacle_unknown_and_unconfirmed_rejections_do_not_mutate(self):
        fixed = {**self.item, 'pose': {'xCm': 200, 'zCm': 150, 'yawRad': 0}}
        issue = self.place(instance=fixed).json()['error']['details']['issues'][0]
        self.assertEqual(issue['code'], 'fixed_obstacle')
        self.assertEqual(issue['obstacleIds'], ['fixed-sofa'])
        edge = {**self.item, 'pose': {'xCm': 45, 'zCm': 300, 'yawRad': 0}}
        self.assertEqual(self.place(instance=edge).json()['error']['details']['issues'][0]['code'], 'unknown_area')
        self.room['scan']['calibration']['status'] = 'unconfirmed'
        self.assertEqual(self.place().json()['error']['details']['issues'][0]['code'], 'scale_unconfirmed')
        self.room['scan']['calibration']['status'] = 'synthetic_demo'
        dry_run = self.place(dryRun=True).json()
        self.assertTrue(dry_run['validation']['valid'])
        self.assertEqual(dry_run['validation']['assurance'], 'synthetic_demo')
        self.assertFalse(dry_run['applied'])
        self.assertEqual(dry_run['revision'], 0)
        self.assertEqual(dry_run['instances'], [])
        self.assertEqual(SceneCommandReceipt.objects.count(), 0)
        applied = self.place().json()
        self.assertEqual(applied['revision'], 1)
        self.assertEqual(self.place().json(), applied)

    def test_full_footprint_coverage_handles_adjacent_areas_rotations_and_holes(self):
        box = footprint({'widthCm': 200, 'depthCm': 50}, {'xCm': 200, 'zCm': 200, 'yawRad': math.pi / 4})
        adjacent = [{'minXcm': 0, 'maxXcm': 200, 'minZcm': 0, 'maxZcm': 500}, {'minXcm': 200, 'maxXcm': 600, 'minZcm': 0, 'maxZcm': 500}]
        self.assertTrue(covered_by_free_areas(box, adjacent))
        adjacent[1]['minXcm'] = 201
        self.assertFalse(covered_by_free_areas(box, adjacent))
        around_hole = [
            {'minXcm': 0, 'maxXcm': 190, 'minZcm': 0, 'maxZcm': 500},
            {'minXcm': 210, 'maxXcm': 600, 'minZcm': 0, 'maxZcm': 500},
            {'minXcm': 190, 'maxXcm': 210, 'minZcm': 0, 'maxZcm': 190},
            {'minXcm': 190, 'maxXcm': 210, 'minZcm': 210, 'maxZcm': 500},
        ]
        self.assertFalse(covered_by_free_areas(box, around_hole))
        self.assertFalse(covered_by_free_areas(box, []))

    def test_rotated_fixed_obstacle_uses_sat_and_accepts_touching_edges(self):
        self.room['spatial']['obstacles'] = [{'obstacleId': 'long', 'label': 'bench', 'xCm': 200, 'zCm': 200, 'widthCm': 200, 'depthCm': 50, 'yawRad': math.pi / 4}]
        # A separated parallel table has overlapping AABBs but no OBB overlap.
        item = {'instanceId': 'table', 'productId': 'test-table', 'pose': {'xCm': 200 + 60 / math.sqrt(2), 'zCm': 200 + 60 / math.sqrt(2), 'yawRad': math.pi / 4}}
        self.assertEqual(validate_instances([item], 'test-scan'), [item])
        item['pose']['xCm'] = item['pose']['zCm'] = 205
        with self.assertRaises(SceneError) as error:
            validate_instances([item], 'test-scan')
        self.assertEqual(error.exception.details['issues'][0]['code'], 'fixed_obstacle')

    def test_geometry_revision_is_pinned_without_replacing_a_layout(self):
        self.assertEqual(self.place().status_code, 200)
        self.room['scan']['geometryRevision'] = 'fixed-v2'
        response = self.client.get('/api/scene/?roomId=test-scan')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['code'], 'geometry_conflict')
        self.assertEqual(self.place(commandId='new', baseRevision=1).status_code, 409)
        row = SceneLayout.objects.get(room_id='test-scan')
        self.assertEqual(row.instances, [self.item])
        self.assertEqual(row.geometry_revision, 'fixed-v1')
        self.assertEqual(row.revision, 1)

    def test_capture_freezes_interior_camera_geometry_and_room(self):
        queued = self.enqueue()
        self.assertEqual(queued.status_code, 202, queued.content)
        original = queued.json()
        self.assertEqual(original['representation'], 'photographic')
        self.assertEqual(original['roomId'], 'test-scan')
        self.assertEqual(original['camera'], self.room['scan']['defaultCamera'])
        self.room['scan']['defaultCamera']['yawRad'] = 1
        self.assertEqual(self.enqueue().json(), original)
        self.assertEqual(self.post('/api/scene/captures/claim/', {}, 'demo-room').json()['job'], None)
        self.place()
        job = self.post('/api/scene/captures/claim/', {}).json()['job']
        self.assertEqual(job['camera']['yawRad'], 0)
        self.assertEqual(job['snapshot']['instances'], [])
        self.assertEqual(job['geometryRevision'], 'fixed-v1')
        self.assertEqual(job['snapshot']['room']['scan']['defaultCamera']['yawRad'], 0)
        complete = self.post(f"/api/scene/captures/{job['captureId']}/complete/", {'leaseToken': job['leaseToken'], 'imageDataUrl': png()})
        self.assertEqual(complete.status_code, 200)
        self.assertEqual(self.client.get(complete.json()['imageUrl']).status_code, 200)
        self.assertEqual(self.client.get(f"/api/scene/captures/{job['captureId']}/").status_code, 404)
        self.assertEqual(Client().get(complete.json()['imageUrl']).status_code, 404)

    def test_scan_camera_and_top_semantics_are_explicit_and_idempotent(self):
        self.assertEqual(self.enqueue(view='top').json()['error']['code'], 'capture_representation_required')
        self.assertEqual(self.enqueue(camera={'azimuthDeg': 37, 'elevationDeg': 35}).json()['error']['code'], 'unsupported_camera')
        for camera in [dict(self.room['scan']['defaultCamera'], xCm=5), dict(self.room['scan']['defaultCamera'], xCm=200, zCm=150), dict(self.room['scan']['defaultCamera'], yCm=0), dict(self.room['scan']['defaultCamera'], fovDeg=150)]:
            self.assertEqual(self.enqueue(camera=camera).status_code, 400)
        top = self.enqueue(view='top', representation='spatial_plan')
        self.assertEqual(top.status_code, 202)
        self.assertIsNone(top.json()['camera'])
        self.assertEqual(top.json()['representation'], 'spatial_plan')
        self.assertEqual(self.enqueue(view='top', representation='photographic').status_code, 409)
        self.assertEqual(self.enqueue(view='top', representation='spatial_plan').json(), top.json())
        custom = dict(self.room['scan']['defaultCamera'], yawRad=1, pitchRad=-0.2)
        self.assertEqual(self.enqueue(requestId='custom', camera=custom).json()['camera'], custom)

    def test_python_tools_accept_the_same_explicit_room_context(self):
        placed = try_place('trusted', self.item, 0, 'place', room_id='test-scan')
        self.assertTrue(placed['ok'])
        self.assertEqual(placed['room']['roomId'], 'test-scan')
        capture = request_scene_capture('trusted', 1, 'plan', view='top', room_id='test-scan', representation='spatial_plan')
        self.assertTrue(capture['ok'])
        self.assertEqual(capture['representation'], 'spatial_plan')


class PreparedRoomLoaderTests(TestCase):
    def test_loader_rejects_traversal_unknown_geometry_and_invalid_free_areas(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'shared' / 'rooms' / 'test-scan'
            package.mkdir(parents=True)
            room = scan_room()
            spatial = room.pop('spatial')
            (package / 'manifest.json').write_text(json.dumps({'room': room, 'spatialFile': 'spatial.json'}))
            (package / 'spatial.json').write_text(json.dumps(spatial))
            with override_settings(BASE_DIR=root / 'backend'):
                self.assertEqual(prepared_room('test-scan')['spatial'], spatial)
                for identifier in ['../test-scan', '/test-scan', '', 'missing']:
                    with self.assertRaises(SceneError) as error:
                        prepared_room(identifier)
                    self.assertEqual(error.exception.code, 'unknown_room')
                spatial['freeAreas'][0]['minXcm'] = -1
                (package / 'spatial.json').write_text(json.dumps(spatial))
                with self.assertRaises(SceneError) as error:
                    prepared_room('test-scan')
                self.assertEqual(error.exception.code, 'room_unavailable')

class EmptyMeshRoomTests(TestCase):
    def test_empty_mesh_room_has_separate_layout_and_rejects_wall_overlap(self):
        room = prepared_room('empty-room')
        self.assertEqual(room['scan']['visualFormat'], 'glb')
        self.assertEqual((room['widthCm'], room['depthCm'], room['heightCm']), (600, 500, 280))
        self.assertEqual(room['spatial']['obstacles'], [])
        client = Client()
        snapshot = client.get('/api/scene/?roomId=empty-room').json()
        self.assertEqual(snapshot['instances'], [])
        item = {'instanceId': 'mesh-sofa', 'productId': 'modular-sofa-grey-scan',
                'pose': {'xCm': 300, 'zCm': 250, 'yawRad': 0}}
        payload = {'baseRevision': 0, 'commandId': 'mesh-place', 'instance': item}
        response = client.post('/api/scene/placement/?roomId=empty-room', payload, content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        item['pose']['xCm'] = 5
        payload.update(baseRevision=1, commandId='mesh-wall')
        response = client.post('/api/scene/placement/?roomId=empty-room', payload, content_type='application/json')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error']['details']['issues'][0]['code'], 'out_of_bounds')
        saved = client.get('/api/scene/?roomId=empty-room').json()
        self.assertEqual(saved['instances'][0]['pose']['xCm'], 300)
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(client.get('/api/scene/?roomId=studio-11').json()['instances'], [])


class CgArchRoomTests(TestCase):
    def test_corridor_and_entry_accept_placement_and_reload_without_crossing_walls(self):
        client = Client()
        item = {'instanceId': 'hall-chair', 'productId': 'test-chair',
                'pose': {'xCm': 400, 'zCm': 490, 'yawRad': 0}}
        for revision, (x, z) in enumerate([(400, 490), (80, 650), (800, 490)]):
            item['pose'].update(xCm=x, zCm=z)
            response = client.post('/api/scene/placement/?roomId=cg-arch-interior',
                                   {'baseRevision': revision, 'commandId': f'hall-{revision}', 'instance': item},
                                   content_type='application/json')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(client.get('/api/scene/?roomId=cg-arch-interior').json()['instances'], [item])
        for x, z in [(400, 420), (400, 300), (500, 650), (10, 490)]:
            with self.subTest(x=x, z=z):
                invalid = copy.deepcopy(item)
                invalid['pose'].update(xCm=x, zCm=z)
                with self.assertRaises(SceneError):
                    validate_instances([invalid], 'cg-arch-interior')

    def test_reviewed_expansion_preserves_saved_layout_revision_and_command_receipt(self):
        client = Client()
        item = {'instanceId': 'old-chair', 'productId': 'test-chair',
                'pose': {'xCm': 950, 'zCm': 600, 'yawRad': 0}}
        payload = {'baseRevision': 0, 'commandId': 'old-command', 'instance': item}
        current = prepared_room('cg-arch-interior')
        legacy = copy.deepcopy(current)
        legacy['revision'] = 1
        legacy['scan']['geometryRevision'] = 'cg-arch-interior-v1'
        legacy['spatial']['freeAreas'] = [{'minXcm': 787, 'maxXcm': 1121, 'minZcm': 180, 'maxZcm': 760}]
        with patch('api.room_context.prepared_room', return_value=legacy):
            before = client.post('/api/scene/placement/?roomId=cg-arch-interior', payload,
                                 content_type='application/json')
        self.assertEqual(before.status_code, 200, before.content)
        row = SceneLayout.objects.get(room_id='cg-arch-interior')
        original_time = row.updated_at
        snapshot = client.get('/api/scene/?roomId=cg-arch-interior').json()
        self.assertEqual(snapshot['geometryRevision'], 'cg-arch-interior-v2')
        self.assertEqual(snapshot['instances'], [item])
        self.assertEqual(snapshot['revision'], 1)
        row.refresh_from_db()
        self.assertEqual(row.geometry_revision, 'cg-arch-interior-v2')
        self.assertEqual(row.updated_at, original_time)
        # Receipts are historical responses, never rewritten by a geometry upgrade.
        retry = client.post('/api/scene/placement/?roomId=cg-arch-interior', payload,
                            content_type='application/json')
        self.assertEqual(retry.json(), before.json())
        self.assertEqual(SceneCommandReceipt.objects.count(), 1)
        self.assertEqual(client.get('/api/scene/?roomId=cg-arch-interior').json()['room'], current)

    def test_expansion_rejects_invalid_legacy_layout_and_unknown_revision_without_mutation(self):
        client = Client()
        client.get('/api/scene/?roomId=cg-arch-interior')
        row = SceneLayout.objects.get(room_id='cg-arch-interior')
        invalid = [{'instanceId': 'invalid', 'productId': 'test-chair',
                    'pose': {'xCm': 400, 'zCm': 300, 'yawRad': 0}}]
        for revision, instances in [('cg-arch-interior-v1', invalid), ('cg-arch-interior-v0', [])]:
            row.geometry_revision, row.instances = revision, instances
            row.save()
            response = client.get('/api/scene/?roomId=cg-arch-interior')
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()['error']['code'], 'geometry_conflict')
            row.refresh_from_db()
            self.assertEqual(row.instances, instances)
            self.assertEqual(row.geometry_revision, revision)

    def test_default_camera_is_on_reviewed_floor_and_capture_freezes_it(self):
        room = prepared_room('cg-arch-interior')
        camera = room['scan']['defaultCamera']
        body = footprint({'widthCm': 40, 'depthCm': 40},
                         {'xCm': camera['xCm'], 'zCm': camera['zCm'], 'yawRad': 0})
        self.assertTrue(covered_by_free_areas(body, room['spatial']['freeAreas']))
        client = Client()
        payload = {'requestId': 'cg-default', 'baseRevision': 0, 'view': 'perspective',
                   'width': 256, 'height': 256}
        queued = client.post('/api/scene/captures/?roomId=cg-arch-interior', payload,
                             content_type='application/json')
        self.assertEqual(queued.status_code, 202, queued.content)
        self.assertEqual(queued.json()['camera'], camera)
        # The source camera is too close to the side wall for our walking clearance.
        unsafe = dict(camera, xCm=1126, zCm=738)
        response = client.post('/api/scene/captures/?roomId=cg-arch-interior',
                               dict(payload, requestId='cg-unsafe', camera=unsafe),
                               content_type='application/json')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error']['code'], 'unsupported_camera')

    def test_extended_living_zone_accepts_sofa_but_rejects_unreviewed_area(self):
        client = Client()
        item = {'instanceId': 'cg-sofa', 'productId': 'modular-sofa-grey-scan',
                'pose': {'xCm': 950, 'zCm': 600, 'yawRad': 0}}
        payload = {'baseRevision': 0, 'commandId': 'cg-place', 'instance': item}
        response = client.post('/api/scene/placement/?roomId=cg-arch-interior', payload,
                               content_type='application/json')
        self.assertEqual(response.status_code, 200, response.content)
        item['pose']['xCm'] = 500
        response = client.post('/api/scene/placement/?roomId=cg-arch-interior',
                               dict(payload, baseRevision=1, commandId='cg-outside'),
                               content_type='application/json')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()['error']['details']['issues'][0]['code'], 'unknown_area')
        saved = client.get('/api/scene/?roomId=cg-arch-interior').json()
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(saved['instances'][0]['pose']['xCm'], 950)
