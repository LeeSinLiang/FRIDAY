"""Session-scoped scene persistence and atomic commands for future agent adapters."""
import copy
import hashlib
import json
import math
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import SceneCommandReceipt, SceneLayout

EPSILON = 1e-6


class SceneError(Exception):
    def __init__(self, code, message, status=400, revision=None):
        super().__init__(message)
        self.code, self.message, self.status, self.revision = code, message, status, revision


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


def validate_instances(instances):
    if not isinstance(instances, list) or len(instances) > 100:
        raise SceneError('validation', 'Provide at most 100 furniture instances.')
    data = fixtures()
    room = data['room']
    products = {p['productId']: p for p in data['products']}
    seen, boxes = set(), []
    for item in instances:
        if not isinstance(item, dict) or set(item) != {'instanceId', 'productId', 'pose'}:
            raise SceneError('validation', 'Each instance needs instanceId, productId, and pose.')
        identifier = item['instanceId']
        if not isinstance(identifier, str) or not identifier.strip() or len(identifier) > 128 or identifier in seen:
            raise SceneError('validation', 'Instance IDs must be unique nonempty strings up to 128 characters.')
        seen.add(identifier)
        if not isinstance(item['productId'], str) or item['productId'] not in products or not valid_pose(item['pose']):
            raise SceneError('validation', 'Use a known product and finite centimeter position and rotation.')
        product, pose = products[item['productId']], item['pose']
        if any(not number(product[key]) or product[key] <= 0 for key in ['widthCm', 'depthCm', 'heightCm']):
            raise SceneError('validation', 'Invalid furniture dimensions.')
        if product['heightCm'] > room['heightCm'] + EPSILON:
            raise SceneError('placement', 'Too tall for this room.')
        box = footprint(product, pose)
        if any(box['center'][i] - box['extents'][i] < -EPSILON or box['center'][i] + box['extents'][i] > room[key] + EPSILON for i, key in enumerate(['widthCm', 'depthCm'])):
            raise SceneError('placement', 'Outside room.')
        for previous, previous_product in boxes:
            if overlaps(box, previous):
                raise SceneError('placement', f"Overlaps {previous_product['name']}.")
        boxes.append((box, product))
    return copy.deepcopy(instances)


def scene_for_session(session_key):
    if not isinstance(session_key, str) or not session_key:
        raise SceneError('session', 'A session is required.', 403)
    return SceneLayout.objects.get_or_create(session_key=session_key)[0]


def serialize(scene):
    return {**fixtures(), 'instances': scene.instances, 'revision': scene.revision}


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
