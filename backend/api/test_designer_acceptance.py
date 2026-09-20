"""Independent geometry acceptance using the packaged building and furniture data.

These tests exercise the designer's stable staging interface without a model call,
browser, or job implementation. Live visual acceptance remains a separate gate.
"""
import copy
import math
import uuid

from django.test import SimpleTestCase

from .designer_geometry import DesignState
from .scene_service import SceneError, geometry_revision, room_context, validate_instances


TABLE = 'ikea-702.211.42'
CHAIR = 'ikea-403.608.74'


def state_for(room_id='demo-room', instances=None, request_id=None, **kwargs):
    snapshot = room_context(room_id)
    snapshot.update(instances=copy.deepcopy(instances or []), revision=7,
                    geometryRevision=geometry_revision(snapshot['room']))
    return DesignState(snapshot, request_id or str(uuid.uuid4()), **kwargs)


def corners(dimensions, pose):
    """Independent rotated-rectangle vertices for projection assertions."""
    angle = pose['yawRad']
    c, s = math.cos(angle), math.sin(angle)
    return [(pose['xCm'] + x*c + z*s, pose['zCm'] - x*s + z*c)
            for x in (-dimensions['widthCm']/2, dimensions['widthCm']/2)
            for z in (-dimensions['depthCm']/2, dimensions['depthCm']/2)]


class DesignerGeometryAcceptanceTests(SimpleTestCase):
    def test_arbitrary_rotation_measures_edge_gap_in_each_requested_frame(self):
        state = state_for(camera={'yawRad': -.83})
        reference = state.stage(TABLE, {'xCm': 190, 'zCm': 315, 'yawRad': .61})['object']
        source_vertices = corners(reference['dimensionsCm'], reference['pose'])
        for frame, angle in [('room', 0), ('reference', .61), ('view', -.83)]:
            for relation, direction in [
                ('right', (math.cos(angle), -math.sin(angle))),
                ('left', (-math.cos(angle), math.sin(angle))),
                ('front', (-math.sin(angle), -math.cos(angle))),
                ('behind', (math.sin(angle), math.cos(angle))),
            ]:
                with self.subTest(frame=frame, relation=relation):
                    pose = state.relative_pose(CHAIR, reference['referenceId'], relation, 37, frame, -.29)
                    target_vertices = corners(state.product(CHAIR), pose)
                    project = lambda point: point[0]*direction[0] + point[1]*direction[1]
                    self.assertAlmostEqual(min(map(project, target_vertices)) - max(map(project, source_vertices)), 37)
                    dx, dz = pose['xCm']-190, pose['zCm']-315
                    self.assertAlmostEqual(dx*direction[1]-dz*direction[0], 0)
                    self.assertEqual(pose['yawRad'], -.29)

    def test_real_glbs_fit_relative_to_an_off_centre_rotated_lobby_table(self):
        state = state_for('london-skyscraper')
        table = state.stage(TABLE, {'xCm': 1500, 'zCm': 500, 'yawRad': .4})['object']
        chair = state.relative(CHAIR, table['referenceId'], 'right', 60, 'reference', .4)['object']
        self.assertAlmostEqual(chair['pose']['xCm'], 1500 + 152*math.cos(.4))
        self.assertAlmostEqual(chair['pose']['zCm'], 500 - 152*math.sin(.4))
        self.assertTrue(table['modelUrl'].endswith('/model.glb'))
        self.assertTrue(chair['modelUrl'].endswith('/model.glb'))
        self.assertEqual(validate_instances(state.instances, 'london-skyscraper'), state.instances)
        self.assertEqual(state.snapshot['instances'], [])
        self.assertEqual(state.snapshot['revision'], 7)

    def test_duplicate_catalogue_models_have_stable_distinct_references(self):
        request_id = str(uuid.uuid4())
        state = state_for(request_id=request_id)
        first = state.stage(CHAIR, {'xCm': 100, 'zCm': 100, 'yawRad': 0})['object']
        second = state.stage(CHAIR, {'xCm': 300, 'zCm': 100, 'yawRad': 0})['object']
        replay = state_for(request_id=request_id)
        repeated = replay.stage(CHAIR, {'xCm': 100, 'zCm': 100, 'yawRad': 0})['object']
        self.assertEqual(first['referenceId'], repeated['referenceId'])
        self.assertNotEqual(first['referenceId'], second['referenceId'])
        self.assertEqual(first['name'], second['name'])
        with self.assertRaises(SceneError) as error:
            state.object(first['name'])
        self.assertEqual(error.exception.code, 'unknown_reference')
        selected = state_for(instances=state.instances, selected_id=second['referenceId'])
        self.assertEqual(selected.object('selected')['pose']['xCm'], 300)

    def test_failed_second_placement_preserves_the_previous_staged_batch(self):
        state = state_for('london-skyscraper')
        state.stage(TABLE, {'xCm': 1500, 'zCm': 500, 'yawRad': .4})
        before = copy.deepcopy((state.instances, state.commands, state.snapshot))
        for pose in [
            {'xCm': 1500, 'zCm': 500, 'yawRad': 0},  # Existing table.
            {'xCm': 1870, 'zCm': 500, 'yawRad': 0},  # Inside AABB, outside reviewed floor.
        ]:
            with self.subTest(pose=pose), self.assertRaises(SceneError):
                state.stage(CHAIR, pose)
            self.assertEqual((state.instances, state.commands, state.snapshot), before)

    def test_reviewed_window_wall_is_a_fixed_reference_and_cannot_be_edited(self):
        state = state_for('haussmann-apartment')
        reference = 'fixed:window-wall'
        wall = state.object(reference)
        self.assertIn('window', wall['name'].lower())
        placed = state.relative(CHAIR, reference, 'left', 90)['object']
        self.assertEqual(placed['pose'], {'xCm': 428, 'zCm': 470, 'yawRad': 0})
        before = copy.deepcopy((state.instances, state.commands))
        for operation in [lambda: state.remove(reference),
                          lambda: state.stage(CHAIR, {'xCm': 400, 'zCm': 470, 'yawRad': 0}, reference)]:
            with self.assertRaises(SceneError):
                operation()
            self.assertEqual((state.instances, state.commands), before)

    def test_fixed_obstacle_collision_reports_its_exact_reference(self):
        state = state_for('haussmann-apartment')
        with self.assertRaises(SceneError) as error:
            state.stage(CHAIR, {'xCm': 570, 'zCm': 470, 'yawRad': 0})
        issue = error.exception.details['issues'][0]
        self.assertEqual(issue['code'], 'fixed_obstacle')
        self.assertEqual(issue['obstacleIds'], ['window-wall'])
        self.assertEqual(state.instances, [])
        self.assertEqual(state.commands, [])

    def test_whole_footprint_crosses_reviewed_seams_but_rejects_an_interior_hole(self):
        state = state_for('haussmann-apartment')
        valid = {'xCm': 420, 'zCm': 600, 'yawRad': 0}
        state.stage(CHAIR, valid)
        hole = {'xCm': 420, 'zCm': 680, 'yawRad': 0}
        areas = state.room['spatial']['freeAreas']
        # All four chair corners are supported; the small missing cell lies inside.
        for x, z in corners(state.product(CHAIR), hole):
            self.assertTrue(any(a['minXcm'] <= x <= a['maxXcm'] and a['minZcm'] <= z <= a['maxZcm'] for a in areas))
        with self.assertRaises(SceneError) as error:
            state.stage(CHAIR, hole)
        self.assertEqual(error.exception.details['issues'][0]['code'], 'unknown_area')
        self.assertEqual(len(state.instances), 1)
        self.assertEqual(state.instances[0]['pose'], valid)

    def test_tabletop_and_cabinet_requests_do_not_become_floor_placements(self):
        state = state_for()
        table = state.stage(TABLE, {'xCm': 250, 'zCm': 250, 'yawRad': 0})['object']
        before = copy.deepcopy((state.instances, state.commands))
        for relation in ('on', 'inside', 'above', 'under'):
            with self.subTest(relation=relation), self.assertRaises(SceneError) as error:
                state.relative(CHAIR, table['referenceId'], relation, 0)
            self.assertEqual(error.exception.code, 'unsupported_relation')
        with self.assertRaises(SceneError):
            state.stage(CHAIR, {'xCm': 250, 'yCm': 74, 'zCm': 250, 'yawRad': 0})
        self.assertEqual((state.instances, state.commands), before)

    def test_floor_and_geometry_identity_are_preserved_for_the_real_building(self):
        lobby, mezzanine = state_for('london-skyscraper'), state_for('london-skyscraper-level-m00')
        item = lobby.stage(CHAIR, {'xCm': 1500, 'zCm': 500, 'yawRad': 0})['object']
        self.assertNotEqual(lobby.snapshot['geometryRevision'], mezzanine.snapshot['geometryRevision'])
        self.assertNotEqual(lobby.inspect()['floor']['elevationM'], mezzanine.inspect()['floor']['elevationM'])
        with self.assertRaises(SceneError) as error:
            mezzanine.object(item['referenceId'])
        self.assertEqual(error.exception.code, 'unknown_reference')
        with self.assertRaises(SceneError):
            mezzanine.stage(CHAIR, item['pose'])
        self.assertEqual(mezzanine.instances, [])

    def test_nonfinite_or_negative_clearance_does_not_change_the_scene(self):
        state = state_for()
        table = state.stage(TABLE, {'xCm': 250, 'zCm': 250, 'yawRad': 0})['object']
        before = copy.deepcopy((state.instances, state.commands))
        for gap in (-.1, float('nan'), float('inf'), True, 1001):
            with self.subTest(gap=gap), self.assertRaises(SceneError):
                state.relative(CHAIR, table['referenceId'], 'right', gap)
        self.assertEqual((state.instances, state.commands), before)
