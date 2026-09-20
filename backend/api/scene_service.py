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

EPSILON = 1e-6


class SceneError(Exception):
    def __init__(self, code, message, status=400, revision=None, details=None):
        super().__init__(message)
        self.code, self.message, self.status, self.revision = code, message, status, revision
        self.details = details


def fixtures():
    return json.loads((Path(settings.BASE_DIR).parent / 'shared' / 'scene-fixtures.json').read_text())


def number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def valid_pose(pose):
    return isinstance(pose, dict) and set(pose) == {'xCm', 'zCm', 'yawRad'} and all(number(value) for value in pose.values())


def footprint(product, pose):
    c, s = math.cos(pose['yawRad']), math.sin(pose['yawRad'])
    half = [product['widthCm'] / 2, product['depthCm'] / 2]
    return {'center': [pose['xCm'], pose['zCm']], 'axes': [[c, -s], [s, c]], 'half': half,
            'extents': [abs(c) * half[0] + abs(s) * half[1], abs(s) * half[0] + abs(c) * half[1]]}


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


def validate_instances(instances):
    if not isinstance(instances, list) or len(instances) > 100:
        raise SceneError('validation', 'Provide at most 100 furniture instances.')
    data = fixtures()
    room = data['room']
    products = {p['productId']: p for p in data['products']}
    seen, boxes = set(), []
    for item in instances:
        if not isinstance(item, dict) or not {'instanceId', 'productId', 'pose'} <= set(item) or set(item) - {'instanceId', 'productId', 'pose', 'product'}:
            raise SceneError('validation', 'Each instance needs instanceId, productId, and pose.')
        identifier = item['instanceId']
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 128 or identifier in seen:
            raise SceneError('validation', 'Instance IDs must be unique nonempty strings up to 128 characters.')
        seen.add(identifier)
        if not isinstance(item['productId'], str) or not valid_pose(item['pose']):
            raise SceneError('validation', 'Use a known product and finite centimeter position and rotation.')
        product, pose = resolve_product(item, products), item['pose']
        if any(not number(product[key]) or product[key] <= 0 for key in ['widthCm', 'depthCm', 'heightCm']):
            raise SceneError('validation', 'Invalid furniture dimensions.')
        if product['heightCm'] > room['heightCm'] + EPSILON:
            raise SceneError('placement', 'Too tall for this room.', details={'issues': [{'code': 'too_tall', 'instanceId': identifier, 'heightCm': product['heightCm'], 'roomHeightCm': room['heightCm']}]})
        box = footprint(product, pose)
        if any(box['center'][i] - box['extents'][i] < -EPSILON or box['center'][i] + box['extents'][i] > room[key] + EPSILON for i, key in enumerate(['widthCm', 'depthCm'])):
            raise SceneError('placement', 'Outside room.', details={'issues': [{'code': 'out_of_bounds', 'instanceId': identifier, 'bounds': {'minX': box['center'][0] - box['extents'][0], 'maxX': box['center'][0] + box['extents'][0], 'minZ': box['center'][1] - box['extents'][1], 'maxZ': box['center'][1] + box['extents'][1]}, 'roomBounds': {'minX': 0, 'maxX': room['widthCm'], 'minZ': 0, 'maxZ': room['depthCm']}}]})
        for previous, previous_product, previous_id in boxes:
            if overlaps(box, previous):
                raise SceneError('placement', f"Overlaps {previous_product['name']}.", details={'issues': [{'code': 'overlap', 'instanceId': identifier, 'conflictingInstanceIds': [previous_id]}]})
        boxes.append((box, product, identifier))
    stored = copy.deepcopy(instances)
    # Persist the server's copy of a carried product, never the client's: name, colour, kind and model
    # come from the catalogue too, so what is saved is always something the editor can load back.
    for item in stored:
        if 'product' in item:
            item['product'] = catalogue_product(item['productId'])
    return stored


def scene_for_session(session_key):
    if not isinstance(session_key, str) or not session_key:
        raise SceneError('session', 'A session is required.', 403)
    return SceneLayout.objects.get_or_create(session_key=session_key)[0]


def serialize(scene):
    data = fixtures()
    known = {product['productId'] for product in data['products']}
    # Catalogue items placed in this scene join the product list, from the server's catalogue rather
    # than the client's copy, so every consumer that looks products up by id keeps working.
    for item in scene.instances:
        if item['productId'] not in known:
            product = catalogue_product(item['productId'])
            if product:
                known.add(item['productId'])
                data['products'].append(product)
    return {**data, 'instances': scene.instances, 'revision': scene.revision}


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
    return serialize(scene)


@transaction.atomic
def save_scene(session_key, base_revision, instances):
    validate_revision(base_revision)
    scene = scene_for_session(session_key)
    scene = SceneLayout.objects.select_for_update().get(pk=scene.pk)
    return store(scene, base_revision, validate_instances(instances))


@transaction.atomic
def apply_scene_commands(session_key, base_revision, command_id, commands):
    validate_revision(base_revision)
    if not isinstance(command_id, str) or not command_id.strip() or len(command_id) > 128:
        raise SceneError('validation', 'commandId must be a nonempty string up to 128 characters.')
    if not isinstance(commands, list) or not 1 <= len(commands) <= 100:
        raise SceneError('validation', 'Provide between 1 and 100 commands.')
    try:
        encoded = json.dumps({'baseRevision': base_revision, 'commands': commands}, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        raise SceneError('validation', 'Commands must contain finite JSON values.')
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    scene = scene_for_session(session_key)
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
        elif kind in ('setPose', 'remove') and set(command) == ({'type', 'instanceId', 'pose'} if kind == 'setPose' else {'type', 'instanceId'}):
            target = next((item for item in instances if item['instanceId'] == command['instanceId']), None)
            if target is None:
                raise SceneError('validation', 'The command refers to an unknown instance.')
            if kind == 'remove':
                instances.remove(target)
            else:
                target['pose'] = command['pose']
        else:
            raise SceneError('validation', 'Use add, setPose, or remove with the documented fields.')
        instances = validate_instances(instances)
    response = {**store(scene, base_revision, instances), 'commandId': command_id}
    SceneCommandReceipt.objects.create(scene=scene, command_id=command_id, payload_hash=digest, response=response)
    return response


@transaction.atomic
def attempt_placement(session_key, payload):
    """Trusted agent entry point. Callers must supply the browser's scoped session."""
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
    # Validate the proposed object's structure before indexing its fields.
    try:
        validate_instances([item])
    except SceneError as error:
        if error.details is None:
            error.details = {'issues': [{'code': 'invalid_instance', 'message': error.message}]}
        raise
    scene = scene_for_session(session_key)
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
    validate_instances([i for i in instances if i['instanceId'] != item['instanceId']] + [item])
    if payload.get('dryRun', False):
        return {'ok': True, 'applied': False, 'validation': {'valid': True, 'issues': []}, **serialize(scene)}
    changed = instances != scene.instances
    result = {'ok': True, 'applied': changed, 'validation': {'valid': True, 'issues': []}, **store(scene, payload['baseRevision'], instances), 'commandId': command_id}
    SceneCommandReceipt.objects.create(scene=scene, command_id=command_id, payload_hash=digest, response=result)
    return result
