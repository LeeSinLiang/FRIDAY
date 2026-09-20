"""Small browser-rendered capture queue, scoped to the same scene session."""
import base64
import binascii
import copy
import hashlib
import json
import math
import struct
import uuid
import zlib
from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import SceneCapture, SceneLayout
from .scene_service import SceneError, covered_by_free_areas, footprint, number, overlaps, room_context, scene_for_session, serialize, validate_instances, validate_revision

# Base64 + JSON stays below Django's default 2.5 MiB request-body limit.
MAX_PNG_BYTES = 1536 * 1024


def expire(scene):
    SceneCapture.objects.filter(scene=scene, status__in=['pending', 'rendering'], expires_at__lte=timezone.now()).update(status='failed', error={'code': 'capture_timeout', 'message': 'No browser completed the capture within 120 seconds. Keep the room open and retry.'}, lease_token=None, lease_until=None, completed_at=timezone.now())


def metadata(job):
    room = job.snapshot.get('room', {})
    result = {'captureId': str(job.pk), 'status': job.status, 'revision': job.revision, 'view': job.view, 'representation': job.representation,
              'roomId': room.get('roomId', job.scene.room_id), 'geometryRevision': job.snapshot.get('geometryRevision', str(room.get('revision', ''))),
              'camera': job.camera, 'width': job.width, 'height': job.height}
    if job.snapshot.get('capturePreview'):
        result.update(preview=True, snapshotKind='staged_preview', acceptedRevision=job.revision,
                      previewHash=job.snapshot['capturePreview']['instancesHash'])
    if job.status == 'ready':
        result.update(imageUrl=f'/api/scene/captures/{job.pk}/image/?roomId={job.scene.room_id}', modelWarnings=job.model_warnings)
    if job.status == 'failed':
        result['error'] = job.error
    return result


def get_capture(session_key, capture_id, room_id='demo-room'):
    scene = scene_for_session(session_key, room_id)
    expire(scene)
    job = SceneCapture.objects.filter(scene=scene, pk=capture_id).first()
    if job is None:
        raise SceneError('not_found', 'Capture not found.', 404)
    return job


def capture_options(payload, room):
    """Resolve a camera only when creating a new job, never on a receipt retry."""
    view = payload['view']
    scanned = bool(room.get('scan'))
    representation = payload.get('representation', 'photographic')
    if scanned and view == 'top' and representation != 'spatial_plan':
        raise SceneError('capture_representation_required', 'Scanned-room top views require representation: spatial_plan. Photographic cutaways are not supported.')
    if representation not in ('photographic', 'spatial_plan') or (representation == 'spatial_plan' and view != 'top'):
        raise SceneError('validation', 'Use photographic perspective or spatial_plan top view.')
    if not scanned and representation == 'spatial_plan':
        raise SceneError('unsupported_representation', 'The legacy room supports photographic captures.')
    if view == 'top':
        if 'camera' in payload:
            raise SceneError('validation', 'Top captures do not accept camera options.')
        return representation, None
    if not scanned:
        camera = payload.get('camera', {'azimuthDeg': 37, 'elevationDeg': 35})
        if not isinstance(camera, dict) or set(camera) != {'azimuthDeg', 'elevationDeg'} or not all(number(n) for n in camera.values()) or not -360 <= camera['azimuthDeg'] <= 360 or not 10 <= camera['elevationDeg'] <= 85:
            raise SceneError('validation', 'Camera needs azimuthDeg between -360 and 360 and elevationDeg between 10 and 85.')
        return representation, copy.deepcopy(camera)
    camera = payload.get('camera', room['scan']['defaultCamera'])
    if isinstance(camera, dict) and ('azimuthDeg' in camera or 'elevationDeg' in camera):
        raise SceneError('unsupported_camera', 'Scanned rooms require an interior firstPerson camera, not orbit angles.')
    fields = {'kind', 'xCm', 'yCm', 'zCm', 'yawRad', 'pitchRad', 'fovDeg'}
    if not isinstance(camera, dict) or set(camera) != fields or camera['kind'] != 'firstPerson' or not all(number(camera[key]) for key in fields - {'kind'}):
        raise SceneError('validation', 'Provide a firstPerson camera with finite centimeter position, yawRad, pitchRad, and fovDeg.')
    if not (0 <= camera['xCm'] <= room['widthCm'] and 0 < camera['yCm'] < room['heightCm'] and 0 <= camera['zCm'] <= room['depthCm'] and abs(camera['pitchRad']) < math.pi / 2 and 30 <= camera['fovDeg'] <= 100):
        raise SceneError('unsupported_camera', 'Camera must be inside the room with pitch between -pi/2 and pi/2 and FOV between 30 and 100 degrees.')
    # A 20 cm radius avoids accepting camera centers through thin fixed obstacles.
    box = footprint({'widthCm': 40, 'depthCm': 40}, {'xCm': camera['xCm'], 'zCm': camera['zCm'], 'yawRad': 0})
    spatial = room.get('spatial', {})
    if not covered_by_free_areas(box, spatial.get('freeAreas', [])) or any(overlaps(box, footprint(obstacle, obstacle)) for obstacle in spatial.get('obstacles', [])):
        raise SceneError('unsupported_camera', 'Camera must be on reviewed floor and outside fixed obstacles.')
    return representation, copy.deepcopy(camera)


@transaction.atomic
def enqueue_capture(session_key, payload, room_id='demo-room', *, preview_instances=None, expected_geometry_revision=None):
    """Freeze accepted geometry or a validated preview supplied by a trusted adapter.

    Preview arguments are intentionally absent from the HTTP payload schema. A
    preview uses the accepted layout revision as its base, not as a claim that its
    furniture was saved. It writes only SceneCapture, never SceneLayout or cart.
    """
    required = {'requestId', 'baseRevision', 'view'}
    if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - {'camera', 'width', 'height', 'representation'}:
        raise SceneError('validation', 'Provide requestId, baseRevision, view, and optional camera/width/height/representation.')
    request_id = payload['requestId']
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 128:
        raise SceneError('validation', 'requestId must be a nonempty string up to 128 characters.')
    validate_revision(payload['baseRevision'])
    view = payload['view']
    if view not in ('top', 'perspective'):
        raise SceneError('validation', 'view must be top or perspective.')
    width, height = payload.get('width', 1024), payload.get('height', 768)
    if any(not isinstance(n, int) or isinstance(n, bool) or not 256 <= n <= 1536 for n in [width, height]) or width * height > 1_800_000:
        raise SceneError('validation', 'Capture dimensions must be 256–1536 pixels and at most 1.8 million pixels.')
    # Bind the requested intent, not the mutable default camera. The resolved
    # camera and complete geometry snapshot are frozen below exactly once.
    try:
        intent = {'revision': payload['baseRevision'], 'view': view, 'options': {key: payload[key] for key in ['camera', 'representation'] if key in payload}, 'width': width, 'height': height}
        if preview_instances is not None:
            intent['previewInstances'] = preview_instances
        if expected_geometry_revision is not None:
            intent['geometryRevision'] = expected_geometry_revision
        digest = hashlib.sha256(json.dumps(intent, sort_keys=True, allow_nan=False).encode()).hexdigest()
    except (ValueError, TypeError):
        raise SceneError('validation', 'Capture options must contain finite JSON values.')
    scene = scene_for_session(session_key, room_id)
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    expire(scene)
    previous = SceneCapture.objects.filter(scene=scene, request_id=request_id).first()
    if previous:
        if previous.payload_hash != digest:
            raise SceneError('request_conflict', 'requestId was used for different capture options.', 409)
        return metadata(previous)
    representation, camera = capture_options(payload, room_context(room_id)['room'])
    if scene.revision != payload['baseRevision']:
        raise SceneError('revision_conflict', 'Reload the scene before requesting a capture.', 409, scene.revision)
    if SceneCapture.objects.filter(scene=scene, status__in=['pending', 'rendering']).count() >= 4:
        raise SceneError('capture_queue_full', 'At most four captures can wait at once.', 429)
    snapshot = serialize(scene)
    if expected_geometry_revision is not None and snapshot['geometryRevision'] != expected_geometry_revision:
        raise SceneError('geometry_conflict', 'The room geometry changed. Inspect it again before capturing.', 409, scene.revision)
    if preview_instances is not None:
        from .catalogue_products import catalogue_product
        snapshot['instances'] = validate_instances(preview_instances, room_id)
        known = {p['productId'] for p in snapshot['products']}
        for item in snapshot['instances']:
            if item['productId'] not in known:
                product = catalogue_product(item['productId'])
                if product is None:
                    raise SceneError('unknown_product', 'The preview product is no longer available.')
                snapshot['products'].append(product)
                known.add(item['productId'])
        snapshot.pop('agentMotion', None)
        snapshot['capturePreview'] = {
            'acceptedRevision': scene.revision,
            'instancesHash': hashlib.sha256(json.dumps(snapshot['instances'], sort_keys=True, allow_nan=False).encode()).hexdigest(),
        }
    job = SceneCapture.objects.create(scene=scene, request_id=request_id, payload_hash=digest, snapshot=snapshot, revision=scene.revision, view=view, representation=representation, camera=camera, width=width, height=height, expires_at=timezone.now() + timedelta(seconds=120))
    prune(scene)
    return metadata(job)


def prune(scene):
    old = list(SceneCapture.objects.filter(scene=scene, status__in=['ready', 'failed']).order_by('-completed_at', '-created_at').values_list('pk', flat=True)[20:])
    SceneCapture.objects.filter(pk__in=old).delete()


@transaction.atomic
def claim_capture(session_key, room_id='demo-room'):
    scene = scene_for_session(session_key, room_id)
    expire(scene)
    now = timezone.now()
    available = Q(status='pending') | Q(status='rendering', lease_until__lte=now)
    job = SceneCapture.objects.select_for_update().filter(available, scene=scene, expires_at__gt=now).order_by('created_at').first()
    if job is None:
        return {'job': None}
    token = uuid.uuid4()
    if not SceneCapture.objects.filter(available, pk=job.pk).update(status='rendering', lease_token=token, lease_until=now + timedelta(seconds=30)):
        return {'job': None}
    return {'job': {'captureId': str(job.pk), 'leaseToken': str(token), 'snapshot': job.snapshot, 'revision': job.revision, 'view': job.view, 'representation': job.representation,
                    'roomId': room_id, 'geometryRevision': job.snapshot.get('geometryRevision', ''), 'camera': job.camera, 'width': job.width, 'height': job.height}}


def decode_png(data_url, width, height):
    prefix = 'data:image/png;base64,'
    if not isinstance(data_url, str) or not data_url.startswith(prefix) or len(data_url) > (MAX_PNG_BYTES * 4 // 3 + 100):
        raise SceneError('invalid_png', 'Provide a PNG data URL of at most 1.5 MiB.')
    try:
        data = base64.b64decode(data_url[len(prefix):], validate=True)
    except (ValueError, binascii.Error):
        raise SceneError('invalid_png', 'PNG base64 is invalid.')
    if len(data) > MAX_PNG_BYTES or not data.startswith(b'\x89PNG\r\n\x1a\n'):
        raise SceneError('invalid_png', 'PNG signature is invalid.')
    offset, saw_header, saw_data, ended = 8, False, False, False
    while offset + 12 <= len(data):
        length = struct.unpack('>I', data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        end = offset + length + 12
        if end > len(data):
            raise SceneError('invalid_png', 'PNG chunk is truncated.')
        body = data[offset + 8:offset + 8 + length]
        crc = struct.unpack('>I', data[end - 4:end])[0]
        if zlib.crc32(kind + body) & 0xffffffff != crc:
            raise SceneError('invalid_png', 'PNG chunk checksum is invalid.')
        if not saw_header:
            if kind != b'IHDR' or length != 13:
                raise SceneError('invalid_png', 'PNG header is missing.')
            actual_width, actual_height = struct.unpack('>II', body[:8])
            if (actual_width, actual_height) != (width, height):
                raise SceneError('invalid_png', 'PNG dimensions do not match the request.')
            saw_header = True
        elif kind == b'IHDR':
            raise SceneError('invalid_png', 'PNG has duplicate headers.')
        saw_data = saw_data or kind == b'IDAT'
        if kind == b'IEND':
            ended = length == 0 and end == len(data)
            break
        offset = end
    if not saw_data or not ended:
        raise SceneError('invalid_png', 'PNG image data or end marker is missing.')
    return data


@transaction.atomic
def complete_capture(session_key, capture_id, payload, room_id='demo-room'):
    scene = scene_for_session(session_key, room_id)
    expire(scene)
    job = SceneCapture.objects.select_for_update().filter(scene=scene, pk=capture_id).first()
    if job is None:
        raise SceneError('not_found', 'Capture not found.', 404)
    if not isinstance(payload, dict) or 'leaseToken' not in payload or set(payload) - {'leaseToken', 'imageDataUrl', 'modelWarnings', 'error'} or ('imageDataUrl' in payload) == ('error' in payload):
        raise SceneError('validation', 'Provide leaseToken and exactly one of imageDataUrl or error.')
    if job.status != 'rendering' or str(job.lease_token) != payload['leaseToken'] or job.lease_until <= timezone.now():
        raise SceneError('lease_conflict', 'Capture lease is expired or belongs to another browser.', 409)
    if 'error' in payload:
        error = payload['error']
        if not isinstance(error, dict) or set(error) != {'code', 'message'} or not all(isinstance(n, str) and n for n in error.values()) or len(error['code']) > 100 or len(error['message']) > 1000:
            raise SceneError('validation', 'Capture error needs a short code and message.')
        job.status, job.error = 'failed', error
    else:
        warnings = payload.get('modelWarnings', [])
        if not isinstance(warnings, list) or len(warnings) > 100 or any(not isinstance(w, str) or len(w) > 500 for w in warnings):
            raise SceneError('validation', 'modelWarnings must contain at most 100 short strings.')
        job.image = decode_png(payload['imageDataUrl'], job.width, job.height)
        job.status, job.model_warnings = 'ready', warnings
    job.lease_token, job.lease_until = None, None
    job.completed_at = timezone.now()
    job.save()
    prune(scene)
    return metadata(job)
