"""Small real-manifest integration tests; geometry and packaging checks do not decode the source GLB."""
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from django.test import TestCase
from .engine_tools import get_scene_context, try_place
from .scene_service import SceneError, validate_instances
from build import package_shared

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / 'shared/skyscraper-test-scene.json').read_text())


class SkyscraperTests(TestCase):
    def test_public_deployment_packages_every_floor_without_models(self):
        source = Path(__file__).resolve().parents[2] / 'shared'
        with TemporaryDirectory() as temporary:
            target = Path(temporary) / 'runtime_shared'
            package_shared(source, target)
            for room_id in ['haussmann-apartment', 'empty-room', *FIXTURE['legacyRoomIds'], *[floor['roomId'] for floor in FIXTURE['floors']]]:
                self.assertTrue((target / 'rooms' / room_id / 'manifest.json').is_file())
                self.assertTrue((target / 'rooms' / room_id / 'spatial.json').is_file())
            self.assertFalse(list(target.rglob('*.glb')))

    def test_asymmetric_wall_rejects_only_its_side_of_the_floor(self):
        item = {'instanceId': 'chair', 'productId': 'test-chair',
                'pose': {'xCm': 330, 'zCm': 700, 'yawRad': 0}}
        with self.assertRaises(SceneError):
            validate_instances([item], 'london-skyscraper-c20')
        item['pose']['xCm'] = 250
        validate_instances([item], 'london-skyscraper-c20')

    def test_floor_transforms_and_agent_context_use_actual_elevations(self):
        elevations = []
        for floor in FIXTURE['floors']:
            context = get_scene_context('skyscraper-test', floor['roomId'])
            self.assertTrue(context['ok'])
            room = context['room']
            scan = room['scan']
            self.assertEqual(scan['building']['surfaceId'], floor['surfaceId'])
            self.assertAlmostEqual(scan['positionCm'][1] + floor['elevationM'] * 100, 0)
            self.assertEqual(scan['scale'], 1)
            self.assertEqual(scan['visualUrl'], '/rooms/london-skyscraper-test/assets/building.glb')
            self.assertEqual(scan['building']['sourceSha256'], FIXTURE['sourceSha256'])
            elevations.append(floor['elevationM'])
        self.assertNotAlmostEqual(elevations[1] - elevations[0], elevations[2] - elevations[1])
        self.assertFalse(get_scene_context('', FIXTURE['buildingId'])['ok'])

    def test_reference_fits_each_floor_edge_is_rejected_and_saves_are_independent(self):
        item = {k: FIXTURE['reference'][k] for k in ['instanceId', 'productId', 'pose']}
        for floor in FIXTURE['floors']:
            room_id = floor['roomId']
            item = {**item, 'pose': floor['referencePose']}
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [])
            dry = try_place('verify', item, 0, 'preview', dry_run=True, room_id=room_id)
            self.assertTrue(dry['ok'], dry)
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [])
            placed = try_place('verify', item, 0, 'place', room_id=room_id)
            self.assertTrue(placed['ok'], placed)
            invalid = {**item, 'pose': {**item['pose'], 'xCm': -1}}
            rejected = try_place('verify', invalid, 1, 'reject', room_id=room_id)
            self.assertFalse(rejected['ok'])
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [item])
            self.assertEqual(get_scene_context('different-session', room_id)['instances'], [])
            moved = {**item, 'pose': {**item['pose'], 'yawRad': 3.141592653589793}}
            self.assertTrue(try_place('verify', moved, 1, 'move', room_id=room_id)['ok'])
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [moved])
            collision = {**moved, 'instanceId': 'overlapping-reference'}
            with self.assertRaises(SceneError):
                validate_instances([moved, collision], room_id)

    def test_entrance_and_mezzanine_precede_tower_and_full_floor_boundary_matches_mesh(self):
        # Confirmed against named Lobby_Floor geometry and actual editor screenshots,
        # not the old Interior_Top-only candidate list (issue #89).
        self.assertEqual(len(FIXTURE['floors']), 34)
        self.assertEqual([f['floorId'] for f in FIXTURE['floors'][:3]], ['G00', 'M00', 'C01'])
        self.assertAlmostEqual(FIXTURE['floors'][0]['elevationM'], -4.2167695, places=5)
        self.assertAlmostEqual(FIXTURE['floors'][1]['elevationM'], -.2095046, places=5)
        for floor in FIXTURE['floors']:
            room = get_scene_context('boundary', floor['roomId'])['room']
            self.assertTrue(room['scan']['floorOutlineCm'])
            self.assertGreater(floor['checkedAreaM2'], 50)
            self.assertLess(floor['unsupportedAreaM2'], 1e-6)
            self.assertLess(floor['blockedAreaM2'], 1e-6)
        item = {'instanceId': 'edge-chair', 'productId': 'test-chair',
                'pose': {'xCm': 1670, 'zCm': 500, 'yawRad': 0}}
        validate_instances([item], FIXTURE['buildingId'])
        # Both points are inside the bounding rectangle; only one is on the mesh.
        item['pose']['xCm'] = 1870
        with self.assertRaises(SceneError) as error:
            validate_instances([item], FIXTURE['buildingId'])
        self.assertEqual(error.exception.details['issues'][0]['code'], 'unknown_area')

    def test_previous_room_context_and_saved_layout_keep_original_coordinates(self):
        old_room = 'london-skyscraper-test'
        item = {'instanceId': 'old-reference', 'productId': 'scale-reference',
                'pose': {'xCm': 250, 'zCm': 400, 'yawRad': 0}}
        self.assertTrue(try_place('legacy', item, 0, 'legacy-save', room_id=old_room)['ok'])
        old = get_scene_context('legacy', old_room)
        self.assertEqual(old['instances'], [item])
        self.assertEqual(old['room']['scan']['positionCm'][::2], [-350, 1250])
        self.assertEqual(get_scene_context('legacy', FIXTURE['buildingId'])['instances'], [])
