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
            for room_id in ['empty-room', *[floor['roomId'] for floor in FIXTURE['floors']]]:
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
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [])
            dry = try_place('verify', item, 0, 'preview', dry_run=True, room_id=room_id)
            self.assertTrue(dry['ok'], dry)
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [])
            placed = try_place('verify', item, 0, 'place', room_id=room_id)
            self.assertTrue(placed['ok'], placed)
            invalid = {**item, 'pose': {**item['pose'], 'xCm': 100}}
            rejected = try_place('verify', invalid, 1, 'reject', room_id=room_id)
            self.assertFalse(rejected['ok'])
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [item])
            self.assertEqual(get_scene_context('different-session', room_id)['instances'], [])
            moved = {**item, 'pose': {**item['pose'], 'xCm': 300, 'zCm': 350}}
            self.assertTrue(try_place('verify', moved, 1, 'move', room_id=room_id)['ok'])
            self.assertEqual(get_scene_context('verify', room_id)['instances'], [moved])
            collision = {**moved, 'instanceId': 'overlapping-reference'}
            with self.assertRaises(SceneError):
                validate_instances([moved, collision], room_id)
