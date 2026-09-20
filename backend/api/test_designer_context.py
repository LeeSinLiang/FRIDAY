import copy
import json
import math
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .designer_context import inspect_context, measure
from .designer_geometry import DesignState
from .scene_service import SceneError, room_context


class DesignerContextTests(SimpleTestCase):
    def state(self, room_id='demo-room', instances=None, **kwargs):
        context = room_context(room_id)
        return DesignState({**context, 'revision': 7, 'instances': instances or []}, 'context-test', **kwargs)

    def pair(self, yaw_a=0, yaw_b=0, x_b=355, z_b=230, **kwargs):
        return self.state(instances=[
            {'instanceId': 'table-a', 'productId': 'test-table', 'pose': {'xCm': 230, 'zCm': 230, 'yawRad': yaw_a}},
            {'instanceId': 'chair-b', 'productId': 'test-chair', 'pose': {'xCm': x_b, 'zCm': z_b, 'yawRad': yaw_b}},
        ], **kwargs)

    def test_complete_skyscraper_floor_geometry_and_transform_are_preserved(self):
        state = self.state('london-skyscraper')
        result = inspect_context(state)
        scan = state.room['scan']
        self.assertEqual(result['floor']['freeAreas'], state.room['spatial']['freeAreas'])
        self.assertEqual(result['floor']['outlineCm'], scan['floorOutlineCm'])
        self.assertEqual(result['floor']['building']['floorId'], 'G00')
        self.assertEqual(result['geometryRevision'], scan['geometryRevision'])
        transform = result['floor']['sourceToRoomTransform']
        self.assertEqual(transform['positionCm'], scan['positionCm'])
        self.assertEqual(transform['rotationDeg'], scan['rotationDeg'])
        self.assertEqual(transform['uniformScale'], scan['scale'])
        self.assertEqual(transform['sourceUnitScaleToCm'], 100)
        self.assertFalse(result['truncated'])
        self.assertGreater(len(result['floor']['freeAreas']), 10)
        self.assertEqual(result['architecture']['semanticAnchors']['status'], 'unavailable')
        self.assertLess(len(json.dumps(result)), 512 * 1024)

    def test_holes_and_empty_reviewed_scan_are_not_replaced_by_bounding_rectangle(self):
        state = self.state('london-skyscraper')
        hole = [[100, 100], [120, 100], [120, 120], [100, 120]]
        state.room['scan']['floorOutlineCm'][0]['holes'] = [hole]
        state.room['spatial']['freeAreas'] = []
        result = inspect_context(state)
        self.assertEqual(result['floor']['outlineCm'][0]['holes'], [hole])
        self.assertEqual(result['floor']['freeAreas'], [])
        self.assertEqual(result['floor']['placementCoverage'], 'reviewed_areas_only')
        result['floor']['outlineCm'][0]['holes'][0][0][0] = -100
        self.assertEqual(state.room['scan']['floorOutlineCm'][0]['holes'][0][0][0], 100)

    def test_fixed_obstacle_reference_and_floor_isolation(self):
        state = self.pair()
        state.room['spatial'] = {'freeAreas': [], 'obstacles': [{
            'obstacleId': 'pillar', 'label': 'Reviewed pillar', 'xCm': 430, 'zCm': 230,
            'yawRad': math.pi / 2, 'widthCm': 40, 'depthCm': 80,
        }]}
        result = inspect_context(state)
        fixed = result['fixedReferences'][0]
        self.assertEqual(fixed['referenceId'], 'fixed:pillar')
        self.assertEqual(fixed['name'], 'Reviewed pillar')
        self.assertEqual(fixed['dimensionsCm'], {'widthCm': 40, 'depthCm': 80})
        self.assertFalse(fixed['editable'])
        self.assertEqual(fixed['heightStatus'], 'unavailable')
        self.assertEqual(measure(state, 'table-a', 'fixed:pillar')['edgeDistanceCm'], 100)
        with self.assertRaises(SceneError):
            measure(self.state('london-skyscraper-level-c01'), 'table-a', 'fixed:pillar')

    def test_exact_object_projection_preserves_duplicate_ids_and_catalogue_provenance(self):
        state = self.pair(math.pi / 2, selected_id='table-a')
        state.instances[1]['productId'] = 'test-table'
        state.products['test-table']['modelUrl'] = '/models/table.glb'
        listing = SimpleNamespace(id='test-table', materials=['oak', 'steel'])
        with patch('api.designer_context.load_catalogue', return_value=[listing]):
            result = inspect_context(state)
        self.assertEqual([o['referenceId'] for o in result['objects']], ['table-a', 'chair-b'])
        self.assertEqual(result['objectCount'], 2)
        first = result['objects'][0]
        self.assertEqual(first['dimensionsCm'], {'widthCm': 120, 'depthCm': 60, 'heightCm': 35})
        self.assertEqual(first['boundsCm']['minX'], 200)
        self.assertEqual(first['boundsCm']['maxZ'], 290)
        self.assertEqual(first['asset']['modelUrl'], '/models/table.glb')
        self.assertEqual(first['appearance']['catalogueMaterials'], ['oak', 'steel'])
        self.assertEqual(first['appearance']['meshMaterials']['status'], 'unavailable')
        self.assertEqual(first['supportSurfaces']['status'], 'unavailable')
        self.assertEqual(first['cavities']['status'], 'unavailable')
        self.assertEqual(result['selectedId'], 'table-a')
        self.assertEqual(first['positionCm'], [230, 0, 230])
        self.assertEqual(first['rotationRad'], [0, math.pi / 2, 0])
        self.assertEqual(first['visibility'], 'unknown_until_captured')
        first['pose']['xCm'] = -10
        self.assertEqual(state.instances[0]['pose']['xCm'], 230)

    def test_staged_snapshot_and_floor_fixture_are_explicit(self):
        state = self.pair()
        original = copy.deepcopy(state.snapshot)
        state.instances[0]['pose']['xCm'] = 240
        state.commands.append({'type': 'setPose'})
        result = inspect_context(state)
        self.assertEqual(result['stateKind'], 'staged')
        self.assertEqual(result['stagedChanges'], 1)
        self.assertEqual(result['objects'][0]['pose']['xCm'], 240)
        self.assertEqual(state.snapshot, original)
        self.assertEqual(result['floor']['freeAreas'], [{'minXcm': 0, 'maxXcm': 600, 'minZcm': 0, 'maxZcm': 500}])
        self.assertEqual(result['floor']['placementCoverage'], 'rectangular_fixture')

    def test_context_limit_rejects_without_silently_truncating(self):
        state = self.pair()
        state.instances *= 51
        with self.assertRaises(SceneError) as error:
            inspect_context(state)
        self.assertEqual(error.exception.code, 'context_limit')

    def test_room_measurement_exact_clearance_and_axis_units(self):
        result = measure(self.pair(), 'table-a', 'chair-b')
        self.assertEqual(result['centerDistanceCm'], 125)
        self.assertEqual(result['edgeDistanceCm'], 30)
        self.assertEqual(result['deltaCm'], {'right': 125, 'front': 0})
        self.assertEqual(result['direction'], {'right': 1, 'front': 0})
        self.assertEqual(result['lengthUnit'], 'cm')
        self.assertFalse(result['overlap'])
        self.assertFalse(result['collisionPolicyApplied'])

    def test_asymmetric_rotated_objects_use_oriented_not_axis_aligned_bounds(self):
        # Put the chair centre 150 cm along its local right axis from the
        # table's extreme corner. The nearest chair edge is then 150 - 35 cm
        # from that corner, independent of the geometry helper under test.
        table_corner = [230 + 90 / math.sqrt(2), 230 - 30 / math.sqrt(2)]
        chair_axis = [math.sqrt(3) / 2, .5]
        center = [table_corner[i] + 150 * chair_axis[i] for i in (0, 1)]
        state = self.pair(math.pi / 4, -math.pi / 6, x_b=center[0], z_b=center[1])
        result = measure(state, 'table-a', 'chair-b')
        self.assertAlmostEqual(result['centerDistanceCm'], math.hypot(center[0] - 230, center[1] - 230))
        self.assertAlmostEqual(result['edgeDistanceCm'], 115)
        self.assertGreater(result['edgeDistanceCm'], 0)
        reverse = measure(state, 'chair-b', 'table-a')
        self.assertAlmostEqual(reverse['edgeDistanceCm'], result['edgeDistanceCm'])
        self.assertAlmostEqual(reverse['deltaCm']['front'], -result['deltaCm']['front'])

    def test_reference_and_view_frames_match_positive_yaw_convention(self):
        state = self.pair(math.pi / 2, x_b=230, z_b=105, camera={'yawRad': -math.pi / 2})
        reference = measure(state, 'table-a', 'chair-b', 'reference')
        self.assertAlmostEqual(reference['deltaCm']['right'], 125)
        self.assertAlmostEqual(reference['deltaCm']['front'], 0)
        view = measure(state, 'table-a', 'chair-b', 'view')
        self.assertAlmostEqual(view['deltaCm']['right'], -125)
        self.assertAlmostEqual(view['deltaCm']['front'], 0)
        state.camera = None
        with self.assertRaises(SceneError):
            measure(state, 'table-a', 'chair-b', 'view')

    def test_three_dimensional_centers_and_vertical_intervals_use_authoritative_heights(self):
        state = self.pair(math.pi / 4, -math.pi / 6)
        result = measure(state, 'table-a', 'chair-b')
        self.assertEqual(result['centerDistanceCm'], 125)
        self.assertAlmostEqual(result['centerDistance3dCm'], math.hypot(125, 20))
        vertical = result['vertical']
        self.assertEqual(vertical['status'], 'available')
        self.assertEqual(vertical['intervalsCm'], {'a': {'minY': 0, 'maxY': 35}, 'b': {'minY': 0, 'maxY': 75}})
        self.assertEqual(vertical['centerDeltaCm'], 20)
        self.assertEqual(vertical['clearanceCm'], 0)
        self.assertEqual(vertical['overlapDepthCm'], 35)
        self.assertEqual(result['boundingPrismDistanceCm'], result['edgeDistanceCm'])
        self.assertFalse(result['boundingPrismOverlap'])
        reverse = measure(state, 'chair-b', 'table-a', 'reference')
        self.assertEqual(reverse['vertical']['centerDeltaCm'], -20)
        self.assertEqual(reverse['centerDistance3dCm'], result['centerDistance3dCm'])
        self.assertEqual(reverse['boundingPrismDistanceCm'], result['boundingPrismDistanceCm'])
        overlapping = measure(self.pair(x_b=300), 'table-a', 'chair-b')
        self.assertTrue(overlapping['boundingPrismOverlap'])
        self.assertEqual(overlapping['boundingPrismDistanceCm'], 0)
        self.assertEqual(overlapping['vertical']['overlapDepthCm'], 35)

    def test_unknown_fixed_height_preserves_horizontal_measurement_and_discloses_missing_3d_data(self):
        state = self.pair()
        state.room['spatial'] = {'freeAreas': [], 'obstacles': [{
            'obstacleId': 'pillar', 'label': 'Tall pillar', 'xCm': 430, 'zCm': 230,
            'yawRad': 0, 'widthCm': 40, 'depthCm': 80,
        }]}
        result = measure(state, 'table-a', 'fixed:pillar')
        self.assertEqual(result['edgeDistanceCm'], 120)
        self.assertEqual(result['centerDistanceCm'], 200)
        self.assertIsNone(result['centerDistance3dCm'])
        self.assertIsNone(result['boundingPrismDistanceCm'])
        self.assertIsNone(result['boundingPrismOverlap'])
        self.assertEqual(result['vertical']['status'], 'unavailable')
        self.assertEqual(result['vertical']['unavailableReferenceIds'], ['fixed:pillar'])
        self.assertEqual(result['vertical']['intervalsCm']['a'], {'minY': 0, 'maxY': 35})
        self.assertIsNone(result['vertical']['intervalsCm']['b'])
        self.assertIsNone(result['vertical']['clearanceCm'])

    def test_overlap_touching_and_identical_centers_are_distinct(self):
        overlapping = measure(self.pair(x_b=300), 'table-a', 'chair-b')
        self.assertTrue(overlapping['overlap'])
        self.assertEqual(overlapping['signedEdgeClearanceCm'], -25)
        self.assertEqual(overlapping['edgeDistanceCm'], 0)
        touching = measure(self.pair(x_b=325), 'table-a', 'chair-b')
        self.assertFalse(touching['overlap'])
        self.assertTrue(touching['touching'])
        centered = measure(self.pair(x_b=230), 'table-a', 'chair-b')
        self.assertIsNone(centered['direction'])
        self.assertTrue(centered['overlap'])
        self.assertEqual(centered['penetrationDepthCm'], 67.5)

    def test_missing_ambiguous_and_same_reference_ids_reject(self):
        state = self.pair(selected_id='table-a')
        self.assertEqual(measure(state, 'selected', 'chair-b')['referenceA'], 'table-a')
        for first, second, frame in [('Stone coffee table', 'chair-b', 'room'),
                                     ('selected', 'table-a', 'room'), ('table-a', 'chair-b', 'blender')]:
            with self.assertRaises(SceneError):
                measure(state, first, second, frame)
