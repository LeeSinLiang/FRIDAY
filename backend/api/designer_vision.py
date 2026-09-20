"""Nonblocking, session-bound scene images for the designer's planning loop.

The trusted orchestrator supplies the session. A model may choose a view or a
stable target ID, but cannot choose somebody else's session or camera position.
"""
import base64
import copy
import math
import uuid

from .capture_service import enqueue_capture, get_capture, metadata
from .scene_service import SceneError, footprint


def _camera(state, target_id, preview):
    camera = state.review_camera() if preview else copy.deepcopy(state.camera)
    if not target_id:
        return camera
    target = state.object(target_id)
    if not camera or camera.get('kind') != 'firstPerson':
        raise SceneError('unsupported_camera', 'Target-focused views require the interior first-person renderer. Use an untargeted view in this room.')
    dx = target['pose']['xCm'] - camera['xCm']
    dz = target['pose']['zCm'] - camera['zCm']
    height = target['dimensionsCm'].get('heightCm')
    target_y = height / 2 if height is not None else camera['yCm']
    camera['yawRad'] = math.atan2(-dx, -dz)
    camera['pitchRad'] = max(-1.3, min(1.3, math.atan2(target_y - camera['yCm'], max(1, math.hypot(dx, dz)))))
    return camera


def request_view(state, trusted_session, request_id, view='perspective', target_id=None, preview=False):
    """Queue one frozen image and return immediately; use read_view to resume.

    The accepted revision and geometry revision are checked under the capture
    queue's scene lock. Staged geometry is revalidated using authoritative product
    records and floor rules. Neither accepted nor preview capture saves furniture.
    """
    if not isinstance(preview, bool):
        raise SceneError('validation', 'preview must be a boolean.')
    if view not in ('perspective', 'top'):
        raise SceneError('validation', 'view must be perspective or top.')
    if target_id is not None and (not isinstance(target_id, str) or not target_id):
        raise SceneError('validation', 'target_id must be a stable object reference.')
    # Validate a requested target even for top views; do not imply an unknown
    # object is shown merely because the floor can be photographed.
    if target_id:
        state.object(target_id)
    payload = {'requestId': request_id, 'baseRevision': state.snapshot['revision'],
               'view': view, 'width': 960, 'height': 720}
    if view == 'top' and state.room.get('scan'):
        payload['representation'] = 'spatial_plan'
    if view == 'perspective':
        camera = _camera(state, target_id, preview)
        if camera is not None:
            payload['camera'] = camera
    result = enqueue_capture(
        trusted_session, payload, state.room['roomId'],
        preview_instances=state.instances if preview else None,
        expected_geometry_revision=state.snapshot.get('geometryRevision'),
    )
    return read_view(trusted_session, state.room['roomId'], result['captureId'])


def _objects(snapshot):
    products = {p['productId']: p for p in snapshot['products']}
    for item in snapshot['instances']:
        product = products[item['productId']]
        yield {'referenceId': item['instanceId'], 'name': product['name'],
               'pose': item['pose'], 'dimensions': product, 'type': 'furniture'}
    for obstacle in snapshot['room'].get('spatial', {}).get('obstacles', []):
        yield {'referenceId': 'fixed:' + obstacle['obstacleId'], 'name': obstacle['label'],
               'pose': obstacle, 'dimensions': obstacle, 'type': 'fixed'}


def _corners(item):
    box = footprint(item['dimensions'], item['pose'])
    return [(box['center'][0] + sx * box['half'][0] * box['axes'][0][0] + sz * box['half'][1] * box['axes'][1][0],
             box['center'][1] + sx * box['half'][0] * box['axes'][0][1] + sz * box['half'][1] * box['axes'][1][1])
            for sx in (-1, 1) for sz in (-1, 1)]


def _pixel_bounds(points, width, height):
    bounds = {'minX': min(p[0] for p in points), 'maxX': max(p[0] for p in points),
              'minY': min(p[1] for p in points), 'maxY': max(p[1] for p in points)}
    intersects = bounds['maxX'] >= 0 and bounds['minX'] <= width and bounds['maxY'] >= 0 and bounds['minY'] <= height
    return {'boundsPixels': {key: round(value, 3) for key, value in bounds.items()},
            'intersectsImage': intersects,
            'fullyInImage': 0 <= bounds['minX'] <= bounds['maxX'] <= width and 0 <= bounds['minY'] <= bounds['maxY'] <= height}


def project_objects(job):
    """Project known bounds, never infer semantic visibility from a screenshot.

    The plan transform mirrors captureSpatialPlan; perspective uses the renderer
    firstPerson Euler convention and vertical FOV. Photographic boxes are the
    projection of dimension boxes, not segmentation masks or measured silhouettes.
    Occlusion by architecture, furniture, transparency, or missing models is not
    computed. Unknown heights and boxes crossing the camera plane stay unknown.
    """
    room, camera = job.snapshot['room'], job.camera
    result = {'coordinates': 'pixels; origin top-left; +x right; +y down',
              'occlusion': 'unknown', 'objects': []}
    if job.view == 'top' and job.representation == 'spatial_plan':
        scale = min((job.width - 56) / room['widthCm'], (job.height - 130) / room['depthCm'])
        origin_x = (job.width - room['widthCm'] * scale) / 2
        origin_y = 66 + (job.height - 130 - room['depthCm'] * scale) / 2
        project = lambda x, y, z: (origin_x + x * scale, origin_y + z * scale)
        result['method'] = 'schematic_rotated_footprint'
    elif job.view == 'top':
        half_height = max((room['depthCm'] + 24) / 2, (room['widthCm'] + 24) / (2 * job.width / job.height)) / .86
        scale = job.height / (2 * half_height)
        project = lambda x, y, z: (job.width / 2 + (x - room['widthCm'] / 2) * scale,
                                    job.height / 2 + (z - room['depthCm'] / 2) * scale)
        result['method'] = 'orthographic_rotated_footprint'
    elif camera and camera.get('kind') == 'firstPerson':
        yaw, pitch = camera['yawRad'], camera['pitchRad']
        sy, cy, sp, cp = math.sin(yaw), math.cos(yaw), math.sin(pitch), math.cos(pitch)
        right, up, forward = (cy, 0, -sy), (sy * sp, cp, cy * sp), (-sy * cp, sp, -cy * cp)
        tangent = math.tan(math.radians(camera['fovDeg']) / 2)
        def project(x, y, z):
            delta = (x - camera['xCm'], y - camera['yCm'], z - camera['zCm'])
            depth = sum(a * b for a, b in zip(delta, forward))
            # Match PlayCanvas runtime.ts's 2 cm near / 20,000 cm far range.
            # A partially clipped box needs polygon clipping to be exact; keep
            # its projection unknown instead of emitting misleading bounds.
            if not 2 < depth < 20_000:
                return None
            return (job.width / 2 + sum(a * b for a, b in zip(delta, right)) / depth / tangent * job.height / 2,
                    job.height / 2 - sum(a * b for a, b in zip(delta, up)) / depth / tangent * job.height / 2)
        result['method'] = 'perspective_rotated_dimension_box'
    else:
        return {**result, 'method': 'unavailable', 'reason': 'Legacy orbit projection is not supplied; use a top view for object mapping.'}
    for item in _objects(job.snapshot):
        entry = {'referenceId': item['referenceId'], 'name': item['name'], 'type': item['type']}
        if job.view == 'perspective' and 'heightCm' not in item['dimensions']:
            result['objects'].append({**entry, 'projectionStatus': 'unknown_height'})
            continue
        levels = (0, item['dimensions']['heightCm']) if job.view == 'perspective' else (0,)
        points = [project(x, y, z) for x, z in _corners(item) for y in levels]
        if any(p is None for p in points):
            result['objects'].append({**entry, 'projectionStatus': 'clipped_depth_range'})
            continue
        result['objects'].append({**entry, 'projectionStatus': 'projected', **_pixel_bounds(points, job.width, job.height)})
    return result


def read_view(trusted_session, room_id, capture_id):
    """Read exactly one capture; a ready result contains the actual PNG bytes."""
    try:
        identifier = uuid.UUID(str(capture_id))
    except (ValueError, TypeError, AttributeError):
        raise SceneError('validation', 'capture_id must be a UUID.')
    job = get_capture(trusted_session, identifier, room_id)
    result = {'ok': job.status != 'failed', **metadata(job),
              'preview': bool(job.snapshot.get('capturePreview')),
              'snapshotKind': 'staged_preview' if job.snapshot.get('capturePreview') else 'accepted',
              'acceptedRevision': job.revision,
              'objectProjection': project_objects(job)}
    if job.status == 'ready':
        result['imageDataUrl'] = 'data:image/png;base64,' + base64.b64encode(bytes(job.image)).decode('ascii')
    return result
