"""Support acceptance grounded in packaged GLB triangles and persisted attachments."""
import copy
import hashlib
import json
import math
import struct
import uuid
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase

from .catalogue_products import catalogue_product
from .designer_geometry import DesignState
from .engine_tools import try_place
from .scene_service import SceneError, apply_scene_commands, room_context, scene_for_session, serialize, validate_instances
from .supports import collides, profile_of


ROOT = Path(__file__).resolve().parents[2] / 'shared'
DESK, MONITOR = 'pc-workspace-desk', 'pc-workspace-display'


def item(identifier, product, x=250, z=250, yaw=0):
    result = {'instanceId': identifier, 'productId': product,
              'pose': {'xCm': x, 'zCm': z, 'yawRad': yaw}}
    if not product.startswith('support-demo-'):
        result['product'] = catalogue_product(product)
    return result


def child(identifier='monitor', product=MONITOR, parent='desk', target='top', kind='surface', x=0, z=0, yaw=0):
    result = item(identifier, product)
    result['attachment'] = {'parentInstanceId': parent, 'profileRevision': '1',
                            'target': {'kind': kind, 'id': target},
                            'localPose': {'xCm': x, 'zCm': z, 'yawRad': yaw}}
    return result


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def glb_triangles(product_id):
    """Read actual FLOAT positions/index buffers and glTF node transforms.

    Curated assets are static triangle meshes; reject unhandled encodings instead
    of pretending accessor bounds alone establish a supported surface.
    """
    binary = (ROOT / 'models' / 'furniture' / product_id / 'model.glb').read_bytes()
    assert binary[:4] == b'glTF'
    json_length = struct.unpack_from('<I', binary, 12)[0]
    doc = json.loads(binary[20:20+json_length])
    blob = binary[28+json_length:]

    def values(index):
        accessor = doc['accessors'][index]
        assert 'sparse' not in accessor
        view = doc['bufferViews'][accessor['bufferView']]
        count = {'SCALAR': 1, 'VEC3': 3}[accessor['type']]
        fmt = '<' + {5126: 'f', 5123: 'H', 5125: 'I', 5121: 'B'}[accessor['componentType']] * count
        stride = view.get('byteStride', struct.calcsize(fmt))
        offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
        return [struct.unpack_from(fmt, blob, offset+i*stride) for i in range(accessor['count'])]

    def multiply(a, b):
        return [sum(a[k*4+row]*b[col*4+k] for k in range(4)) for col in range(4) for row in range(4)]

    def transform(m, point):
        return tuple(100*sum(m[k*4+axis]*v for k, v in enumerate((*point, 1))) for axis in range(3))

    triangles = []

    def visit(index, parent):
        node = doc['nodes'][index]
        # These assets use identity TRS or explicit matrices. Make future asset
        # replacement fail visibly if its transform convention changes.
        assert node.get('rotation', [0, 0, 0, 1]) == [0, 0, 0, 1]
        local = list(node.get('matrix', IDENTITY))
        if 'matrix' not in node:
            local[0], local[5], local[10] = node.get('scale', [1, 1, 1])
            local[12:15] = node.get('translation', [0, 0, 0])
        matrix = multiply(parent, local)
        if 'mesh' in node:
            for primitive in doc['meshes'][node['mesh']]['primitives']:
                assert primitive.get('mode', 4) == 4
                positions = [transform(matrix, p) for p in values(primitive['attributes']['POSITION'])]
                indices = [i[0] for i in values(primitive['indices'])] if 'indices' in primitive else range(len(positions))
                triangles.extend([positions[i] for i in indices[start:start+3]] for start in range(0, len(indices), 3))
        for nested in node.get('children', []):
            visit(nested, matrix)

    for node in doc['scenes'][doc.get('scene', 0)]['nodes']:
        visit(node, IDENTITY)
    return binary, triangles


def clipped_area(triangle, target):
    polygon = [(v[0], v[2]) for v in triangle]
    for axis, bound, keep_greater in [(0, target['xCm']-target['widthCm']/2, True),
                                       (0, target['xCm']+target['widthCm']/2, False),
                                       (1, target['zCm']-target['depthCm']/2, True),
                                       (1, target['zCm']+target['depthCm']/2, False)]:
        result = []
        for start, end in zip(polygon, polygon[1:]+polygon[:1]):
            inside_start = start[axis] >= bound if keep_greater else start[axis] <= bound
            inside_end = end[axis] >= bound if keep_greater else end[axis] <= bound
            if inside_start:
                result.append(start)
            if inside_start != inside_end:
                t = (bound-start[axis])/(end[axis]-start[axis])
                result.append(tuple(start[k]+t*(end[k]-start[k]) for k in (0, 1)))
        polygon = result
    return abs(sum(a[0]*b[1]-b[0]*a[1] for a, b in zip(polygon, polygon[1:]+polygon[:1])))/2


class DesignerSupportAcceptanceTests(TestCase):
    def test_pc_assets_match_authored_dimensions_pivot_and_byte_hash(self):
        for product_id in (DESK, MONITOR, 'pc-workspace-shelf'):
            with self.subTest(product=product_id):
                metadata = json.loads((ROOT/'models'/'furniture'/product_id/'metadata.json').read_text())
                binary, triangles = glb_triangles(product_id)
                self.assertEqual(hashlib.sha256(binary).hexdigest(), metadata['modelSha256'])
                minimum = [min(v[axis] for t in triangles for v in t) for axis in range(3)]
                maximum = [max(v[axis] for t in triangles for v in t) for axis in range(3)]
                for axis, key in enumerate(('widthCm', 'heightCm', 'depthCm')):
                    self.assertAlmostEqual(maximum[axis]-minimum[axis], metadata[key], places=4)
                self.assertAlmostEqual(minimum[1], 0, places=4)
                self.assertAlmostEqual(minimum[0]+maximum[0], 0, places=4)
                self.assertAlmostEqual(minimum[2]+maximum[2], 0, places=4)

    def test_pc_support_rectangles_are_fully_covered_by_actual_horizontal_triangles(self):
        for product_id in (DESK, 'pc-workspace-shelf'):
            profile = profile_of(catalogue_product(product_id))
            binary, triangles = glb_triangles(product_id)
            self.assertEqual(hashlib.sha256(binary).hexdigest(), profile['modelSha256'])
            for target in profile['targets']:
                with self.subTest(product=product_id, target=target['id']):
                    plane = [t for t in triangles if all(abs(v[1]-target['yCm']) < .0001 for v in t)]
                    self.assertTrue(plane)
                    area = sum(clipped_area(t, target) for t in plane)
                    # Float32 exports introduce sub-micrometre edge differences.
                    self.assertAlmostEqual(area, target['widthCm']*target['depthCm'], places=3)

    def test_demo_cabinet_shelves_and_cavity_are_backed_by_exact_authored_panels(self):
        cabinet = next(p for p in room_context()['products'] if p['productId'] == 'support-demo-cabinet')
        profile = profile_of(cabinet)
        binary, triangles = glb_triangles('support-demo-cabinet')
        self.assertEqual(hashlib.sha256(binary).hexdigest(), profile['modelSha256'])
        for target in profile['targets']:
            plane = [t for t in triangles if all(abs(v[1]-target['yCm']) < .0001 for v in t)]
            self.assertAlmostEqual(sum(clipped_area(t, target) for t in plane), target['widthCm']*target['depthCm'], places=3)
        self.assertEqual([(t['yCm'], t['heightCm']) for t in profile['targets'] if t['kind'] == 'compartment'], [(3, 45.5), (51.5, 45.5)])

    def test_real_monitor_fits_desktop_and_server_derives_contact_height(self):
        monitor = child(x=60)
        monitor['pose']['yCm'] = 999
        saved = validate_instances([item('desk', DESK), monitor])
        self.assertEqual(saved[1]['pose'], {'xCm': 310, 'zCm': 250, 'yawRad': 0, 'yCm': 75})
        monitor['attachment']['localPose']['xCm'] = 60.01
        with self.assertRaises(SceneError) as error:
            validate_instances([item('desk', DESK), monitor])
        self.assertEqual(error.exception.code, 'support_overhang')
        monitor['attachment']['localPose'].update(xCm=0, zCm=15.01, yawRad=math.pi/2)
        with self.assertRaises(SceneError) as error:
            validate_instances([item('desk', DESK), monitor])
        self.assertEqual(error.exception.code, 'support_overhang')

    def test_parent_move_and_rotation_inherit_world_height_position_and_yaw(self):
        commands = [{'type': 'add', 'instance': i} for i in [item('desk', DESK), child(x=30, z=10, yaw=.2)]]
        initial = apply_scene_commands('pc-inherit', 0, 'seed', commands)
        moved = apply_scene_commands('pc-inherit', 1, 'move', [{'type': 'setPose', 'instanceId': 'desk',
                                      'pose': {'xCm': 350, 'zCm': 200, 'yawRad': math.pi/2}}])
        monitor = next(i for i in moved['instances'] if i['instanceId'] == 'monitor')
        self.assertAlmostEqual(monitor['pose']['xCm'], 360)
        self.assertAlmostEqual(monitor['pose']['zCm'], 170)
        self.assertAlmostEqual(monitor['pose']['yawRad'], math.pi/2+.2)
        self.assertEqual(monitor['pose']['yCm'], 75)
        self.assertEqual(monitor['attachment'], initial['instances'][1]['attachment'])
        self.assertEqual(serialize(scene_for_session('pc-inherit'))['instances'], moved['instances'])

    def test_support_height_counts_towards_room_headroom(self):
        context = room_context()
        context['room']['heightCm'] = 116
        with patch('api.scene_service.room_context', return_value=context), self.assertRaises(SceneError) as error:
            validate_instances([item('desk', DESK), child()])
        self.assertEqual(error.exception.details['issues'][0]['code'], 'too_tall')

    def test_compartment_limits_and_panel_collision_are_not_bypassed(self):
        cabinet = item('cabinet', 'support-demo-cabinet')
        box = child('box', 'support-demo-box', 'cabinet', 'upper', 'compartment', z=1.5)
        resolved = validate_instances([cabinet, box])
        products = {p['productId']: p for p in room_context()['products']}
        self.assertEqual(resolved[1]['pose']['yCm'], 51.5)
        self.assertFalse(collides(resolved[0], products[cabinet['productId']], resolved[1], products[box['productId']]))
        through_panel = copy.deepcopy(resolved[1])
        through_panel['pose']['zCm'] = 231  # Back panel occupies local Z=-20..-17.
        self.assertTrue(collides(resolved[0], products[cabinet['productId']], through_panel, products[box['productId']]))
        box['attachment']['localPose']['zCm'] = -19
        with self.assertRaises(SceneError) as error:
            validate_instances([cabinet, box])
        self.assertEqual(error.exception.code, 'support_overhang')
        context = room_context()
        next(p for p in context['products'] if p['productId'] == 'support-demo-box')['heightCm'] = 45.6
        box['attachment']['localPose']['zCm'] = 1.5
        with patch('api.scene_service.room_context', return_value=context), self.assertRaises(SceneError) as error:
            validate_instances([cabinet, box])
        self.assertEqual(error.exception.code, 'outside_compartment')

    def test_supported_dry_run_and_commit_keep_identical_attachment_and_pose(self):
        apply_scene_commands('pc-parity', 0, 'desk', [{'type': 'add', 'instance': item('desk', DESK, yaw=.4)}])
        monitor = child(x=30, z=-12, yaw=-.2)
        preview = try_place('pc-parity', monitor, 1, 'attach-monitor', dry_run=True)
        self.assertTrue(preview['ok'], preview)
        self.assertEqual(len(scene_for_session('pc-parity').instances), 1)
        accepted = try_place('pc-parity', monitor, 1, 'attach-monitor')
        self.assertTrue(accepted['ok'], accepted)
        self.assertEqual(accepted['instances'][-1], preview['resolvedInstance'])
        self.assertEqual(try_place('pc-parity', monitor, 1, 'attach-monitor'), accepted)

    def test_failed_parent_move_and_parent_removal_preserve_the_whole_assembly(self):
        initial = apply_scene_commands('pc-atomic', 0, 'seed', [
            {'type': 'add', 'instance': item('desk', DESK)}, {'type': 'add', 'instance': child()}])
        for command in [{'type': 'setPose', 'instanceId': 'desk', 'pose': {'xCm': 10, 'zCm': 10, 'yawRad': 0}},
                        {'type': 'remove', 'instanceId': 'desk'}]:
            with self.subTest(command=command), self.assertRaises(SceneError):
                apply_scene_commands('pc-atomic', 1, 'rejected', [command])
            self.assertEqual(serialize(scene_for_session('pc-atomic'))['instances'], initial['instances'])

    def test_designer_support_and_inherited_move_stage_exactly_what_commands_persist(self):
        snapshot = apply_scene_commands('designer-pc', 0, 'desk', [{'type': 'add', 'instance': item('desk', DESK, yaw=.4)}])
        state = DesignState(snapshot, str(uuid.uuid4()))
        target = next(t for t in state.support_references() if t['referenceId'] == 'desk/top')
        monitor = state.supported(MONITOR, target['referenceId'], 'on', target['profileRevision'], 30, -12, .2)['object']
        state.stage(DESK, {'xCm': 350, 'zCm': 200, 'yawRad': .9}, 'desk')
        self.assertEqual(len(scene_for_session('designer-pc').instances), 1)
        saved = apply_scene_commands('designer-pc', 1, 'agent-batch', state.commands)
        by_id = lambda instances: {i['instanceId']: i for i in instances}
        self.assertEqual(by_id(saved['instances']), by_id(state.instances))
        self.assertEqual(by_id(saved['instances'])[monitor['referenceId']]['pose']['yCm'], 75)
        self.assertEqual(by_id(saved['instances'])[monitor['referenceId']]['attachment']['localPose'],
                         {'xCm': 30, 'zCm': -12, 'yawRad': .2})
        detached = DesignState(saved, str(uuid.uuid4()))
        detached.stage(MONITOR, {'xCm': 100, 'zCm': 100, 'yawRad': 0}, monitor['referenceId'], attachment=None)
        saved_detach = apply_scene_commands('designer-pc', 2, 'detach', detached.commands)
        self.assertEqual(by_id(saved_detach['instances']), by_id(detached.instances))
        self.assertNotIn('attachment', by_id(saved_detach['instances'])[monitor['referenceId']])

    def test_designer_compartment_target_stages_and_persists_the_same_shelf(self):
        snapshot = apply_scene_commands('designer-cabinet', 0, 'cabinet', [
            {'type': 'add', 'instance': item('cabinet', 'support-demo-cabinet', yaw=.5)}])
        state = DesignState(snapshot, str(uuid.uuid4()))
        box = state.supported('support-demo-box', 'cabinet/upper', 'inside', '1')['object']
        self.assertEqual(box['pose']['yCm'], 51.5)
        before = copy.deepcopy((state.instances, state.commands))
        with self.assertRaises(SceneError) as error:
            state.supported('support-demo-box', 'cabinet/lower', 'inside', 'outdated')
        self.assertEqual(error.exception.code, 'stale_profile')
        self.assertEqual((state.instances, state.commands), before)
        saved = apply_scene_commands('designer-cabinet', 1, 'agent-box', state.commands)
        self.assertEqual(saved['instances'], state.instances)
        self.assertEqual(saved['instances'][-1]['attachment']['target'], {'kind': 'compartment', 'id': 'upper'})

    def test_monitor_fits_the_real_pc_lower_shelf_at_its_measured_height(self):
        shelf = item('shelf', 'pc-workspace-shelf')
        monitor = child(parent='shelf', target='lower', kind='compartment')
        accepted = validate_instances([shelf, monitor])
        self.assertEqual(accepted[-1]['pose']['yCm'], 32.5)
        self.assertEqual(accepted[-1]['pose']['yCm']+catalogue_product(MONITOR)['heightCm'], 74.5)
        self.assertLess(74.5, 85)  # Next plank begins at Y85 in the actual shelf GLB.
