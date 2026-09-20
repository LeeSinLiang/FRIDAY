"""Session-scoped scene persistence and atomic commands for future agent adapters."""
import copy
import hashlib
import json
import math
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .catalogue_products import agrees_with_catalogue, catalogue_product, well_formed
from .models import SceneCommandReceipt, SceneLayout
from .shared_data import shared_root

EPSILON = 1e-6
# A rug does not stop a chair: an item this low neither blocks other items nor is blocked by them. It must still lie
# inside the room and clear of fixed obstacles. KEEP IN STEP with FLAT_MAX_CM in frontend/src/scene/placement.ts: the
# editor's check and this one must agree, or the editor accepts a placement the save then refuses.
FLAT_MAX_CM = 3


class SceneError(Exception):
    def __init__(self, code, message, status=400, revision=None, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.revision = code, message, status, revision
        self.details = details


ROOM_SEPARATOR = ':'


def room_presets():
    return json.loads((shared_root() / 'scene-fixtures.json').read_text()).get('rooms', {})


def layout_key(session_key, room_id=None):
    """The storage key for a session's layout in a room. Each room preset keeps its own layout, so
    switching rooms never drags furniture into walls. The default room uses the bare session key,
    exactly as before presets existed."""
    if not room_id:
        return session_key
    if room_id not in room_presets():
        raise SceneError('validation', 'Unknown room.')
    return f'{session_key}{ROOM_SEPARATOR}{room_id}'


def room_id_of(key):
    return key.split(ROOM_SEPARATOR, 1)[1] if isinstance(key, str) and ROOM_SEPARATOR in key else None


def fixtures(room_id=None):
    data = json.loads((shared_root() / 'scene-fixtures.json').read_text())
    presets = data.pop('rooms', {})
    if room_id:
        data['room'] = presets[room_id]['room']
    return data


def room_context(room_id='demo-room'):
    data = fixtures()
    if room_id and room_id != data['room']['roomId']:
        presets = room_presets()
        if room_id in presets:
            data['room'] = presets[room_id]['room']
        else:
            from .room_context import prepared_room
            data['room'] = prepared_room(room_id)
    return data


def geometry_revision(room):
    return room.get('scan', {}).get('geometryRevision', str(room['revision']))


def placement_assurance(room):
    return room.get('scan', {}).get('calibration', {}).get('status', 'fixture')


def number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def valid_pose(pose):
    return isinstance(pose, dict) and {'xCm', 'zCm', 'yawRad'} <= set(pose) and not set(pose) - {'xCm', 'zCm', 'yawRad', 'yCm'} and all(number(value) for value in pose.values())


def footprint(product, pose):
    c, s = math.cos(pose['yawRad']), math.sin(pose['yawRad'])
    half = [product['widthCm'] / 2, product['depthCm'] / 2]
    return {'center': [pose['xCm'], pose['zCm']], 'axes': [[c, -s], [s, c]], 'half': half,
            'extents': [abs(c) * half[0] + abs(s) * half[1], abs(s) * half[0] + abs(c) * half[1]]}


def is_flat(product):
    return product['heightCm'] <= FLAT_MAX_CM + EPSILON


def overlaps(a, b):
    delta = [b['center'][i] - a['center'][i] for i in range(2)]
    dot = lambda x, y: x[0] * y[0] + x[1] * y[1]
    for axis in a['axes'] + b['axes']:
        radius_a = sum(a['half'][i] * abs(dot(a['axes'][i], axis)) for i in range(2))
        radius_b = sum(b['half'][i] * abs(dot(b['axes'][i], axis)) for i in range(2))
        if abs(dot(delta, axis)) >= radius_a + radius_b - EPSILON:
            return False
    return True


def resolve_product(item, products):
    """The product an instance refers to. Fixture products resolve by id exactly as before.

    Any other id must be a catalogue listing. The instance may carry the product inline so clients
    need no fixture entry, but the server's catalogue is the authority on its dimensions.
    """
    product_id = item['productId']
    if product_id in products:
        if 'product' in item:
            raise SceneError('validation', 'Shared products must not carry an inline product.')
        return products[product_id]
    authoritative = catalogue_product(product_id)
    if authoritative is None:
        raise SceneError('validation', 'Use a known product and finite centimeter position and rotation.')
    carried = item.get('product')
    if carried is None:
        raise SceneError('validation', 'A catalogue item must carry its product.')
    if not well_formed(carried, product_id):
        raise SceneError('validation', 'The carried product is malformed.')
    if not agrees_with_catalogue(carried, authoritative):
        raise SceneError('validation', 'The carried product does not match the catalogue.', details={'issues': [{
            'code': 'product_mismatch', 'productId': product_id,
            'catalogueCm': {key: authoritative[key] for key in ('widthCm', 'depthCm', 'heightCm')}}]})
    return authoritative


def polygon(box):
    return [[box['center'][axis] + sx * box['half'][0] * box['axes'][0][axis] + sz * box['half'][1] * box['axes'][1][axis]
             for axis in range(2)] for sx, sz in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]


def clip_polygon(points, axis, boundary, keep_greater):
    """Clip a convex footprint to one half-plane, retaining exact intersections."""
    result = []
    if not points:
        return result
    previous = points[-1]
    previous_inside = previous[axis] >= boundary if keep_greater else previous[axis] <= boundary
    for current in points:
        current_inside = current[axis] >= boundary if keep_greater else current[axis] <= boundary
        if current_inside != previous_inside:
            ratio = (boundary - previous[axis]) / (current[axis] - previous[axis])
            result.append([previous[i] + ratio * (current[i] - previous[i]) for i in range(2)])
        if current_inside:
            result.append(current)
        previous, previous_inside = current, current_inside
    return result


def polygon_area(points):
    return abs(sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1]
                   for i in range(len(points)))) / 2 if points else 0


def covered_by_free_areas(box, areas):
    # Subtract the union of reviewed rectangles from the entire rotated footprint.
    # Checking only its corners would incorrectly accept holes and narrow unknown gaps.
    remaining = [polygon(box)]
    for area in areas:
        next_remaining = []
        boundaries = [(0, area['minXcm'], True), (0, area['maxXcm'], False), (1, area['minZcm'], True), (1, area['maxZcm'], False)]
        for fragment in remaining:
            inside = fragment
            for axis, boundary, greater in boundaries:
                outside = clip_polygon(inside, axis, boundary, not greater)
                if polygon_area(outside) > EPSILON:
                    next_remaining.append(outside)
                inside = clip_polygon(inside, axis, boundary, greater)
                if polygon_area(inside) <= EPSILON:
                    break
        remaining = next_remaining
        if not remaining:
            return True
    return not remaining


def validate_fixed_geometry(room, box, identifier):
    if not room.get('scan'):
        return
    if placement_assurance(room) not in ('confirmed', 'synthetic_demo'):
        raise SceneError('placement', 'Room scale is unconfirmed. Calibrate before placing furniture.', details={'issues': [{'code': 'scale_unconfirmed', 'instanceId': identifier}]})
    spatial = room.get('spatial', {})
    for obstacle in spatial.get('obstacles', []):
        if overlaps(box, footprint(obstacle, obstacle)):
            raise SceneError('placement', f"Overlaps fixed {obstacle['label']}.", details={'issues': [{'code': 'fixed_obstacle', 'instanceId': identifier, 'obstacleIds': [obstacle['obstacleId']]}]})
    if not covered_by_free_areas(box, spatial.get('freeAreas', [])):
        raise SceneError('placement', 'Unverified area. The entire furniture footprint must stay on reviewed floor.', details={'issues': [{'code': 'unknown_area', 'instanceId': identifier}]})


def validate_instances(instances, room_id='demo-room'):
    if not isinstance(instances, list) or len(instances) > 100:
        raise SceneError('validation', 'Provide at most 100 furniture instances.')
    data = room_context(room_id)
    room = data['room']
    products = {p['productId']: p for p in data['products']}
    seen, boxes = set(), []
    resolved_products = {}
    for item in instances:
        if not isinstance(item, dict) or not {'instanceId', 'productId', 'pose'} <= set(item) or set(item) - {'instanceId', 'productId', 'pose', 'product', 'attachment'}:
            raise SceneError('validation', 'Each instance needs instanceId, productId, and pose.')
        identifier = item['instanceId']
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 128 or identifier in seen:
            raise SceneError('validation', 'Instance IDs must be unique nonempty strings up to 128 characters.')
        seen.add(identifier)
        if not isinstance(item['productId'], str) or not valid_pose(item['pose']):
            raise SceneError('validation', 'Use a known product and finite centimeter position and rotation.')
        resolved_products[item['productId']] = resolve_product(item, products)
    from .supports import resolve_attachments, support_fit, collides
    instances = resolve_attachments(instances, resolved_products)
    for item in instances:
        identifier = item['instanceId']
        product, pose = resolved_products[item['productId']], item['pose']
        support_fit(item, product, instances, resolved_products)
        if any(not number(product[key]) or product[key] <= 0 for key in ['widthCm', 'depthCm', 'heightCm']):
            raise SceneError('validation', 'Invalid furniture dimensions.')
        if pose.get('yCm', 0) + product['heightCm'] > room['heightCm'] + EPSILON:
            raise SceneError('placement', 'Too tall for this room.', details={'issues': [{'code': 'too_tall', 'instanceId': identifier, 'heightCm': product['heightCm'], 'roomHeightCm': room['heightCm']}]})
        box = footprint(product, pose)
        if any(box['center'][i] - box['extents'][i] < -EPSILON or box['center'][i] + box['extents'][i] > room[key] + EPSILON for i, key in enumerate(['widthCm', 'depthCm'])):
            raise SceneError('placement', 'Outside room.', details={'issues': [{'code': 'out_of_bounds', 'instanceId': identifier, 'bounds': {'minX': box['center'][0] - box['extents'][0], 'maxX': box['center'][0] + box['extents'][0], 'minZ': box['center'][1] - box['extents'][1], 'maxZ': box['center'][1] + box['extents'][1]}, 'roomBounds': {'minX': 0, 'maxX': room['widthCm'], 'minZ': 0, 'maxZ': room['depthCm']}}]})
        validate_fixed_geometry(room, box, identifier)
        for previous, previous_product, previous_id in boxes:
            if (is_flat(product) and not item.get("attachment")) or (is_flat(previous_product) and not previous.get("attachment")):
                continue
            if collides(item, product, previous, previous_product):
                raise SceneError('placement', f"Overlaps {previous_product['name']}.", details={'issues': [{'code': 'overlap', 'instanceId': identifier, 'conflictingInstanceIds': [previous_id]}]})
        boxes.append((item, product, identifier))
    stored = copy.deepcopy(instances)
    # Persist the server's copy of a carried product, never the client's: name, colour, kind and model
    # come from the catalogue too, so what is saved is always something the editor can load back.
    for item in stored:
        if 'product' in item:
            item['product'] = catalogue_product(item['productId'])
    return stored


def scene_for_session(session_key, room_id='demo-room'):
    if not isinstance(session_key, str) or not session_key:
        raise SceneError('session', 'A session is required.', 403)
    context = room_context(room_id)
    # Preset rooms seed furniture only when a new per-room layout is created.
    seeded = copy.deepcopy(room_presets().get(room_id, {}).get('instances', []))
    return SceneLayout.objects.get_or_create(
        session_key=session_key, room_id=room_id,
        defaults={'geometry_revision': geometry_revision(context['room']), 'instances': seeded},
    )[0]


def serialize(scene):
    context = room_context(scene.room_id)
    revision = geometry_revision(context['room'])
    if scene.geometry_revision and scene.geometry_revision != revision:
        raise SceneError('geometry_conflict', 'The fixed room geometry changed. Activate a new room ID to preserve this layout.', 409, scene.revision)
    known = {product['productId'] for product in context['products']}
    # All catalogue dimensions and rendering metadata stay server-authoritative.
    for item in scene.instances:
        if item['productId'] not in known:
            product = catalogue_product(item['productId'])
            if product:
                known.add(item['productId'])
                context['products'].append(product)
    snapshot = {**context, 'instances': scene.instances, 'revision': scene.revision, 'geometryRevision': revision}
    # Only replay the agent move for this exact revision. Later manual edits clear it,
    # while no-op receipts at the same revision must not hide the original move.
    receipt = SceneCommandReceipt.objects.filter(
        scene=scene, response__agentMotion__revision=scene.revision,
    ).order_by('-pk').first()
    if receipt:
        snapshot['agentMotion'] = receipt.response['agentMotion']
    return snapshot


def validate_revision(revision):
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 0:
        raise SceneError('validation', 'baseRevision must be a nonnegative integer.')


def store(scene, revision, instances):
    if scene.revision != revision:
        raise SceneError('revision_conflict', 'The scene changed. Reload before saving.', 409, scene.revision)
    if instances == scene.instances:
        return serialize(scene)
    updated = SceneLayout.objects.filter(pk=scene.pk, revision=revision).update(instances=instances, revision=revision + 1, updated_at=timezone.now())
    if not updated:
        raise SceneError('revision_conflict', 'The scene changed. Reload before saving.', 409)
    scene.instances, scene.revision = instances, revision + 1
    from shopping.services import sync_scene_cart
    sync_scene_cart(scene)
    return serialize(scene)


@transaction.atomic
def save_scene(session_key, base_revision, instances, room_id='demo-room'):
    from shopping.services import lock_scene_cart
    lock_scene_cart(session_key)
    validate_revision(base_revision)
    scene = scene_for_session(session_key, room_id)
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    return store(scene, base_revision, validate_instances(instances, room_id))


@transaction.atomic
def apply_scene_commands(session_key, base_revision, command_id, commands, room_id='demo-room'):
    from shopping.services import lock_scene_cart
    lock_scene_cart(session_key)
    validate_revision(base_revision)
    if not isinstance(command_id, str) or not command_id.strip() or len(command_id) > 128:
        raise SceneError('validation', 'commandId must be a nonempty string up to 128 characters.')
    if not isinstance(commands, list) or not 1 <= len(commands) <= 200:
        raise SceneError('validation', 'Provide between 1 and 200 commands; at most 100 furniture instances may exist at any step.')
    try:
        encoded = json.dumps({'baseRevision': base_revision, 'commands': commands}, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        raise SceneError('validation', 'Commands must contain finite JSON values.')
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    scene = scene_for_session(session_key, room_id)
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    receipt = SceneCommandReceipt.objects.filter(scene=scene, command_id=command_id).first()
    if receipt:
        if receipt.payload_hash != digest:
            raise SceneError('command_conflict', 'commandId was already used for a different payload.', 409, scene.revision)
        return receipt.response
    if scene.revision != base_revision:
        raise SceneError('revision_conflict', 'The scene changed. Reload before applying commands.', 409, scene.revision)
    instances = copy.deepcopy(scene.instances)
    for command in commands:
        if not isinstance(command, dict):
            raise SceneError('validation', 'Each command must be an object.')
        kind = command.get('type')
        if kind == 'add' and set(command) == {'type', 'instance'}:
            instances.append(command['instance'])
            # Structural and placement validation after each command avoids invalid
            # intermediate geometry while the entire batch still commits atomically.
        elif kind in ('setPose', 'remove') and (set(command) in ({'type', 'instanceId', 'pose'}, {'type', 'instanceId', 'pose', 'attachment'}) if kind == 'setPose' else set(command) == {'type', 'instanceId'}):
            target = next((item for item in instances if item['instanceId'] == command['instanceId']), None)
            if target is None:
                raise SceneError('validation', 'The command refers to an unknown instance.')
            if kind == 'remove':
                if any(i.get('attachment', {}).get('parentInstanceId') == target['instanceId'] for i in instances):
                    raise SceneError('has_children', 'Remove or relocate supported items before removing their support.')
                instances.remove(target)
            else:
                if not valid_pose(command['pose']):
                    raise SceneError('validation', 'Invalid pose.')
                from .supports import move_attachment
                known = {p['productId']: p for p in room_context(room_id)['products']}
                resolved = {i['productId']: resolve_product(i, known) for i in instances}
                move_attachment(target, command['pose'], instances, resolved, 'attachment' in command, command.get('attachment'))
        else:
            raise SceneError('validation', 'Use add, setPose, or remove with the documented fields.')
        instances = validate_instances(instances, room_id)
    previous_ids = {item['instanceId'] for item in scene.instances}
    response = {**store(scene, base_revision, instances), 'commandId': command_id}
    # A user's single-item add gets the same welcome helpers; history restores
    # and manual moves must not look like a new delivery.
    if len(commands) == 1 and commands[0].get('type') == 'add':
        item = commands[0]['instance']
        if item['instanceId'] not in previous_ids:
            response['agentMotion'] = {
                'revision': scene.revision, 'instanceId': item['instanceId'],
                'fromPose': None, 'toPose': copy.deepcopy(item['pose']),
            }
    SceneCommandReceipt.objects.create(scene=scene, command_id=command_id, payload_hash=digest, response=response)
    return response


@transaction.atomic
def attempt_placement(session_key, payload, room_id='demo-room'):
    """Trusted agent entry point. Callers must supply the browser's scoped session."""
    from shopping.services import lock_scene_cart
    lock_scene_cart(session_key)
    required = {'baseRevision', 'commandId', 'instance'}
    if not isinstance(payload, dict) or not required <= set(payload) or set(payload) - required - {'dryRun'}:
        raise SceneError('validation', 'Provide baseRevision, commandId, instance, and optional dryRun.')
    if not isinstance(payload.get('dryRun', False), bool):
        raise SceneError('validation', 'dryRun must be boolean.')
    validate_revision(payload['baseRevision'])
    command_id = payload['commandId']
    if not isinstance(command_id, str) or not command_id.strip() or len(command_id) > 128:
        raise SceneError('validation', 'commandId must be a nonempty string up to 128 characters.')
    item = payload['instance']
    if (not isinstance(item, dict) or not isinstance(item.get('instanceId'), str)
            or not isinstance(item.get('productId'), str) or not valid_pose(item.get('pose'))):
        raise SceneError('validation', 'Provide a valid instance.')
    scene = scene_for_session(session_key, room_id)
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    existing = next((i for i in scene.instances if i['instanceId'] == item['instanceId']), None)
    # A stable upsert payload hash makes retries independent of whether the first
    # attempt added or moved the object. Receipts share the existing command namespace.
    digest = hashlib.sha256(json.dumps({'placement': payload['instance'], 'baseRevision': payload['baseRevision']}, sort_keys=True, allow_nan=False).encode()).hexdigest()
    if not payload.get('dryRun', False):
        receipt = SceneCommandReceipt.objects.filter(scene=scene, command_id=command_id).first()
        if receipt:
            if receipt.payload_hash != digest:
                raise SceneError('command_conflict', 'commandId was already used for a different payload.', 409, scene.revision)
            return receipt.response
    if existing and existing['productId'] != item['productId']:
        raise SceneError('product_mismatch', 'An existing instance cannot change product.', revision=scene.revision)
    if scene.revision != payload['baseRevision']:
        raise SceneError('revision_conflict', 'The scene changed. Reload before placing.', 409, scene.revision)
    instances = [copy.deepcopy(item) if i['instanceId'] == item['instanceId'] else copy.deepcopy(i) for i in scene.instances]
    if existing is None:
        instances.append(copy.deepcopy(item))
    # Validate target last so any collision identifies the attempted object and
    # names the existing obstacle, without changing persisted object order.
    validated = validate_instances([i for i in instances if i['instanceId'] != item['instanceId']] + [item], room_id)
    by_id = {i['instanceId']: i for i in validated}
    instances = [by_id[i['instanceId']] for i in instances]
    item = by_id[item['instanceId']]
    assurance = placement_assurance(room_context(room_id)['room'])
    if payload.get('dryRun', False):
        return {'ok': True, 'applied': False, 'resolvedInstance': item, 'validation': {'valid': True, 'issues': [], 'assurance': assurance}, **serialize(scene)}
    changed = instances != scene.instances
    result = {'ok': True, 'applied': changed, 'validation': {'valid': True, 'issues': [], 'assurance': assurance}, **store(scene, payload['baseRevision'], instances), 'commandId': command_id}
    if changed:
        result['agentMotion'] = {
            'revision': scene.revision,
            'instanceId': item['instanceId'],
            'fromPose': copy.deepcopy(existing['pose']) if existing else None,
            'toPose': copy.deepcopy(item['pose']),
        }
    SceneCommandReceipt.objects.create(scene=scene, command_id=command_id, payload_hash=digest, response=result)
    return result
