"""Read-only, bounded scene projection and deterministic floor measurements.

These helpers expose the same centimetre geometry that validates edits. They do
not derive architectural semantics, support surfaces or visibility from a mesh
name, furniture category or screenshot.
"""
import copy
import json
import math

from catalogue.feed import load_catalogue

from .designer_geometry import FRAME
from .scene_service import EPSILON, SceneError, footprint, geometry_revision, number, polygon


MAX_CONTEXT_BYTES = 512 * 1024
MAX_OUTLINE_POINTS = 8192


def _footprint(obj):
    return footprint(obj['dimensionsCm'], obj['pose'])


def _object_context(state, reference_id, listings):
    original = state.object(reference_id)
    result = {key: copy.deepcopy(original[key]) for key in
              ('referenceId', 'type', 'name', 'pose', 'dimensionsCm', 'boundsCm', 'modelUrl', 'productId')
              if key in original}
    result.update({
        'footprintCm': polygon(_footprint(original)),
        'parentReferenceId': None,
        'children': [],
        'visibility': 'unknown_until_captured',
        'supportSurfaces': {'status': 'unavailable'},
        'cavities': {'status': 'unavailable'},
    })
    if original['type'] == 'furniture':
        product = state.product(original['productId'])
        listing = listings.get(original['productId'])
        result.update({
            'positionCm': [original['pose']['xCm'], 0, original['pose']['zCm']],
            'rotationRad': [0, original['pose']['yawRad'], 0],
            'instanceScale': [1, 1, 1],
            'geometrySource': 'authoritative_scene_product',
            'collisionRepresentation': 'oriented_floor_rectangle',
            'asset': {'modelUrl': product.get('modelUrl'),
                      'representation': 'glb' if product.get('modelUrl') else 'dimensioned_proxy',
                      'loadStatus': 'unknown_until_captured'},
            'appearance': {
                'fallbackColor': product.get('color'),
                'catalogueMaterials': list(listing.materials) if listing else None,
                'catalogueMaterialsSource': 'catalogue' if listing else 'unavailable',
                'meshMaterials': {'status': 'unavailable'},
            },
        })
    else:
        result.update({'geometrySource': 'reviewed_fixed_obstacle',
                       'collisionRepresentation': 'oriented_floor_rectangle',
                       'heightStatus': 'unavailable', 'editable': False})
    return result


def inspect_context(state):
    """Project the frozen floor plus all currently staged objects, without secrets.

    No truncation: an oversized context fails explicitly. A scan's bounding box
    and visual outline are not substituted for its reviewed placement regions.
    """
    room = state.room
    scan, spatial = room.get('scan', {}), room.get('spatial', {})
    areas, obstacles = spatial.get('freeAreas', []), spatial.get('obstacles', [])
    outlines = scan.get('floorOutlineCm', [])
    point_count = sum(len(part.get('outer', [])) + sum(map(len, part.get('holes', []))) for part in outlines)
    if len(state.instances) > 100 or len(areas) > 256 or len(obstacles) > 512 or point_count > MAX_OUTLINE_POINTS:
        raise SceneError('context_limit', 'The complete scene context exceeds the supported geometry limits.')
    if not scan and not spatial:
        areas = [{'minXcm': 0, 'maxXcm': room['widthCm'], 'minZcm': 0, 'maxZcm': room['depthCm']}]
    product_ids = {item['productId'] for item in state.instances}
    listings = {listing.id: listing for listing in load_catalogue() if listing.id in product_ids}
    objects = [_object_context(state, item['instanceId'], listings) for item in state.instances]
    fixed = [_object_context(state, 'fixed:' + obstacle['obstacleId'], listings) for obstacle in obstacles]
    building = scan.get('building', {})
    floor = {
        'dimensionsCm': {key: room[key] for key in ('widthCm', 'depthCm', 'heightCm')},
        'freeAreas': copy.deepcopy(areas),
        'freeAreasMeaning': 'Union of reviewed rectangles; the entire rotated footprint must be covered.',
        'placementCoverage': 'reviewed_areas_only' if scan or spatial else 'rectangular_fixture',
        'outlineCm': copy.deepcopy(outlines),
        'outlineStatus': 'available' if outlines else 'unavailable',
        'outlineMeaning': 'Visual floor boundary with holes; it does not replace freeAreas for placement.',
        'building': {key: copy.deepcopy(building[key]) for key in
                     ('buildingId', 'floorId', 'surfaceId', 'label', 'elevationM', 'sourceOriginM',
                      'sourceSha256', 'clearanceCm', 'supportErrorMaxMm') if key in building},
        'sourceToRoomTransform': ({
            'positionCm': copy.deepcopy(scan['positionCm']),
            'rotationDeg': copy.deepcopy(scan['rotationDeg']),
            'uniformScale': scan['scale'],
            'sourceLengthUnit': 'm', 'targetLengthUnit': 'cm',
            'sourceUnitScaleToCm': 100,
            'convention': 'Renderer TRS: source metres scaled and rotated, then translated in room centimetres.',
        } if scan else None),
        'calibration': copy.deepcopy(scan.get('calibration', {'status': 'fixture'})),
    }
    result = {
        'schemaVersion': 1, 'roomId': room['roomId'], 'revision': state.snapshot['revision'],
        'geometryRevision': state.snapshot.get('geometryRevision') or geometry_revision(room),
        'frame': {**FRAME, 'space': 'active_floor', 'floorAxes': ['X', 'Z']},
        'camera': copy.deepcopy(state.camera), 'selectedId': state.selected_id,
        'stagedChanges': len(state.commands), 'stateKind': 'staged' if state.commands else 'saved',
        'floor': floor, 'objects': objects, 'objectCount': len(objects),
        'fixedReferences': fixed, 'fixedReferenceCount': len(fixed), 'truncated': False,
        'architecture': {
            'visualAsset': {key: scan[key] for key in ('visualFormat', 'visualUrl', 'surfaceUrl') if key in scan},
            'semanticAnchors': {'status': 'unavailable', 'reason': 'No authoritative wall, window or door reference contract.'},
            'materials': {'status': 'unavailable'},
        },
        'unavailable': ['renderer_visibility', 'mesh_material_assignments', 'architectural_semantic_anchors',
                        'tabletop_support_surfaces', 'cabinet_cavities', 'vertical_placement'],
        'measurementScope': 'Horizontal authoritative footprints; not mesh-surface, support or containment measurements.',
    }
    if len(json.dumps(result, allow_nan=False).encode()) > MAX_CONTEXT_BYTES:
        raise SceneError('context_limit', 'The complete scene context exceeds the supported payload size.')
    return result


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def _point_edge_distance(point, start, end):
    edge = [end[i] - start[i] for i in (0, 1)]
    delta = [point[i] - start[i] for i in (0, 1)]
    amount = max(0, min(1, _dot(delta, edge) / _dot(edge, edge)))
    return math.hypot(*(delta[i] - amount * edge[i] for i in (0, 1)))


def _vertical_measurement(first, second, horizontal_distance, edge_distance, footprint_overlap):
    """The current write contract only has floor furniture, with pivot Y = 0.

    A fixed obstacle has an XZ footprint but no authoritative height. Neither a
    label nor the room's ceiling height can supply its missing vertical extent.
    """
    intervals = []
    unavailable = []
    for obj in (first, second):
        height = obj['dimensionsCm'].get('heightCm')
        known = obj['type'] == 'furniture' and number(height) and height > 0
        intervals.append({'minY': 0, 'maxY': height} if known else None)
        if not known:
            unavailable.append(obj['referenceId'])
    vertical = {'status': 'unavailable' if unavailable else 'available',
                'intervalsCm': {'a': intervals[0], 'b': intervals[1]},
                'centerDeltaCm': None, 'clearanceCm': None, 'overlapDepthCm': None}
    result = {'centerDistance3dCm': None, 'boundingPrismDistanceCm': None,
              'boundingPrismOverlap': None, 'vertical': vertical}
    if unavailable:
        vertical.update({'unavailableReferenceIds': unavailable,
                         'reason': 'No authoritative floor pivot and height for these references.'})
        return result
    a, b = intervals
    dy = (b['minY'] + b['maxY'] - a['minY'] - a['maxY']) / 2
    clearance = max(0, b['minY'] - a['maxY'], a['minY'] - b['maxY'])
    overlap = max(0, min(a['maxY'], b['maxY']) - max(a['minY'], b['minY']))
    vertical.update({'centerDeltaCm': dy, 'clearanceCm': clearance, 'overlapDepthCm': overlap,
                     'source': 'authoritative_product_height_and_floor_pivot'})
    result.update({'centerDistance3dCm': math.hypot(horizontal_distance, dy),
                   'boundingPrismDistanceCm': math.hypot(edge_distance, clearance),
                   'boundingPrismOverlap': footprint_overlap and overlap > EPSILON})
    return result


def measure(state, reference_a, reference_b, frame='room'):
    """Measure B relative to A, using exact oriented rectangular footprints.

    Positive clearance is the shortest Euclidean footprint distance. A negative
    signed clearance is the minimum translation required to separate overlap,
    not a distance between mesh surfaces. Reference axes use A's yaw. Additional
    3D fields describe product bounding prisms only when both heights are known.
    """
    if frame not in ('room', 'reference', 'view'):
        raise SceneError('unsupported_frame', 'Use room, reference or view coordinates.')
    first, second = state.object(reference_a), state.object(reference_b)
    if first['referenceId'] == second['referenceId']:
        raise SceneError('validation', 'Choose two different reference IDs to measure.')
    if frame == 'view' and not state.camera:
        raise SceneError('unknown_reference', 'A view-relative measurement needs the current camera.')
    angle = first['pose']['yawRad'] if frame == 'reference' else state.camera['yawRad'] if frame == 'view' else 0
    right, forward = [math.cos(angle), -math.sin(angle)], [-math.sin(angle), -math.cos(angle)]
    a, b = _footprint(first), _footprint(second)
    delta = [b['center'][i] - a['center'][i] for i in (0, 1)]
    distance = math.hypot(*delta)
    gaps = [abs(_dot(delta, axis)) - sum(
        box['half'][i] * abs(_dot(box['axes'][i], axis)) for box in (a, b) for i in (0, 1))
        for axis in a['axes'] + b['axes']]
    gap = max(gaps)
    overlapping = gap < -EPSILON
    penetration = -gap if overlapping else 0.0
    clearance = 0.0
    if gap > EPSILON:
        pa, pb = polygon(a), polygon(b)
        clearance = min(_point_edge_distance(point, ring[i], ring[(i + 1) % 4])
                        for points, ring in ((pa, pb), (pb, pa)) for point in points for i in range(4))
    return {
        'referenceA': first['referenceId'], 'referenceB': second['referenceId'],
        'roomId': state.room['roomId'], 'revision': state.snapshot['revision'],
        'geometryRevision': state.snapshot.get('geometryRevision') or geometry_revision(state.room),
        'stagedChanges': len(state.commands), 'frame': frame, 'lengthUnit': 'cm',
        'measurementPlane': 'floor_XZ', 'centerDistanceCm': distance,
        'deltaCm': {'right': _dot(delta, right), 'front': _dot(delta, forward)},
        'roomDeltaCm': {'x': delta[0], 'z': delta[1]},
        'direction': ({'right': _dot(delta, right) / distance, 'front': _dot(delta, forward) / distance}
                      if distance > EPSILON else None),
        'edgeDistanceCm': clearance, 'overlap': overlapping, 'penetrationDepthCm': penetration,
        'signedEdgeClearanceCm': -penetration if overlapping else clearance,
        'touching': not overlapping and clearance <= EPSILON,
        **_vertical_measurement(first, second, distance, clearance, overlapping),
        'geometry': 'authoritative_oriented_floor_rectangles', 'collisionPolicyApplied': False,
        'threeDimensionalGeometry': 'floor_pivoted_product_bounding_prisms_when_heights_available',
        'limitations': ['Does not measure triangle mesh surfaces, support or containment.',
                        'All current furniture has floor pivot Y = 0; 3D distances use product bounding prisms.',
                        'Footprint overlap is independent of flat-rug collision exemptions.'],
    }
