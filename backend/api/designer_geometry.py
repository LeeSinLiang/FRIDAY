"""Authoritative, SDK-independent scene references and staged floor edits."""
import copy
import math
import uuid

from .catalogue_products import catalogue_product
from .scene_service import SceneError, footprint, number, validate_instances


FRAME = {'lengthUnit': 'cm', 'angleUnit': 'rad', 'upAxis': '+Y',
         'right': '+X', 'front': '-Z', 'pivot': 'footprint-center-at-floor'}


class DesignState:
    def __init__(self, snapshot, request_id, selected_id=None, camera=None):
        self.snapshot = copy.deepcopy(snapshot)
        self.room = self.snapshot['room']
        self.products = {p['productId']: p for p in self.snapshot['products']}
        self.instances = copy.deepcopy(self.snapshot['instances'])
        self.commands, self.trace = [], []
        self.request_id, self.selected_id = request_id, selected_id
        self.camera = camera or self.room.get('scan', {}).get('defaultCamera')
        if selected_id and not any(i['instanceId'] == selected_id for i in self.instances):
            raise SceneError('unknown_reference', 'The selected object is no longer in this room.', 409)

    def product(self, product_id):
        product = self.products.get(product_id) or catalogue_product(product_id)
        if not product:
            raise SceneError('unknown_product', 'Search available models before choosing a product ID.')
        return product

    def object(self, reference_id):
        if reference_id == 'selected':
            reference_id = self.selected_id
        item = next((i for i in self.instances if i['instanceId'] == reference_id), None)
        if item:
            p = self.product(item['productId'])
            box = footprint(p, item['pose'])
            return {'referenceId': item['instanceId'], 'type': 'furniture', **copy.deepcopy(item),
                    'name': p['name'], 'dimensionsCm': {k: p[k] for k in ('widthCm', 'depthCm', 'heightCm')},
                    'modelUrl': p.get('modelUrl'), 'boundsCm': {
                        'minX': box['center'][0] - box['extents'][0], 'maxX': box['center'][0] + box['extents'][0],
                        'minZ': box['center'][1] - box['extents'][1], 'maxZ': box['center'][1] + box['extents'][1],
                        'minY': 0, 'maxY': p['heightCm']}, 'frame': FRAME}
        obstacle = next((o for o in self.room.get('spatial', {}).get('obstacles', [])
                         if 'fixed:' + o['obstacleId'] == reference_id), None)
        if obstacle:
            return {'referenceId': reference_id, 'type': 'fixed', 'name': obstacle['label'],
                    'pose': {k: obstacle[k] for k in ('xCm', 'zCm', 'yawRad')},
                    'dimensionsCm': {k: obstacle[k] for k in ('widthCm', 'depthCm')}, 'frame': FRAME}
        raise SceneError('unknown_reference', 'Choose an exact reference ID returned by inspect_scene. No object was changed.')

    def inspect(self):
        scan = self.room.get('scan', {})
        return {'roomId': self.room['roomId'], 'revision': self.snapshot['revision'],
                'geometryRevision': self.snapshot.get('geometryRevision'), 'frame': FRAME,
                'floor': scan.get('building'), 'camera': self.camera, 'selectedId': self.selected_id,
                'roomDimensionsCm': {k: self.room[k] for k in ('widthCm', 'depthCm', 'heightCm')},
                'objectCount': len(self.instances), 'truncated': False,
                'objects': [{'referenceId': i['instanceId'], 'productId': i['productId'],
                             'name': self.product(i['productId'])['name'], 'pose': i['pose']} for i in self.instances],
                'fixedReferences': [{'referenceId': 'fixed:' + o['obstacleId'], 'name': o['label']}
                                    for o in self.room.get('spatial', {}).get('obstacles', [])],
                'stagedChanges': len(self.commands),
                'capabilities': ['inspect', 'model_search', 'floor_placement', 'relative_placement', 'move', 'remove'],
                'unsupported': ['tabletop_support', 'cabinet_containment', 'architectural_mesh_edits',
                                'unlabelled_window_or_wall_references', 'purchase', 'checkout']}

    def _item(self, product_id, pose, moving_id=None):
        if moving_id:
            current = self.object(moving_id)
            if current['type'] != 'furniture' or current['productId'] != product_id:
                raise SceneError('validation', 'A move must retain the referenced furniture product.')
            return {**next(i for i in self.instances if i['instanceId'] == current['instanceId']), 'pose': pose}
        identifier = 'ai-' + str(uuid.uuid5(uuid.NAMESPACE_URL, self.request_id + ':' + str(len(self.commands))))
        item = {'instanceId': identifier, 'productId': product_id, 'pose': pose}
        if catalogue_product(product_id):
            item['product'] = catalogue_product(product_id)
        return item

    def _checked(self, item):
        return validate_instances([i for i in self.instances if i['instanceId'] != item['instanceId']] + [item], self.room['roomId'])

    def stage(self, product_id, pose, moving_id=None):
        if len(self.commands) >= 12:
            raise SceneError('limit', 'At most 12 layout changes per request.')
        item = self._item(product_id, pose, moving_id)
        checked = self._checked(item)
        self.instances = checked
        self.products[product_id] = self.product(product_id)
        command = {'type': 'setPose', 'instanceId': item['instanceId'], 'pose': pose} if moving_id else {'type': 'add', 'instance': item}
        self.commands.append(command)
        return {'ok': True, 'status': 'staged_not_saved', 'object': self.object(item['instanceId'])}

    def relative_pose(self, product_id, reference_id, relation, gap_cm, frame='room', yaw_rad=0):
        if not number(gap_cm) or not 0 <= gap_cm <= 1000 or not number(yaw_rad):
            raise SceneError('validation', 'Use finite rotation and edge clearance between 0 and 1000 cm.')
        ref = self.object(reference_id)
        if relation not in ('left', 'right', 'front', 'behind') or frame not in ('room', 'reference', 'view'):
            raise SceneError('unsupported_relation', 'Use left/right/front/behind in room, reference or view coordinates. Vertical stacking is unsupported.')
        if frame == 'view' and not self.camera:
            raise SceneError('unknown_reference', 'A view-relative placement needs the current camera.')
        angle = ref['pose']['yawRad'] if frame == 'reference' else self.camera['yawRad'] if frame == 'view' else 0
        right, front = [math.cos(angle), -math.sin(angle)], [-math.sin(angle), -math.cos(angle)]
        direction = right if relation in ('left', 'right') else front
        sign = -1 if relation in ('left', 'behind') else 1
        direction = [v * sign for v in direction]
        target = footprint(self.product(product_id), {'xCm': 0, 'zCm': 0, 'yawRad': yaw_rad})
        source = footprint(ref['dimensionsCm'], ref['pose'])
        def radius(box):
            return sum(box['half'][i] * abs(sum(box['axes'][i][j] * direction[j] for j in (0, 1))) for i in (0, 1))
        distance = radius(source) + radius(target) + gap_cm
        return {'xCm': ref['pose']['xCm'] + direction[0] * distance,
                'zCm': ref['pose']['zCm'] + direction[1] * distance, 'yawRad': yaw_rad}

    def relative(self, product_id, reference_id, relation, gap_cm, frame='room', yaw_rad=0, moving_id=None):
        if moving_id and self.object(moving_id)['referenceId'] == self.object(reference_id)['referenceId']:
            raise SceneError('validation', 'An object cannot be positioned relative to itself.')
        pose = self.relative_pose(product_id, reference_id, relation, gap_cm, frame, yaw_rad)
        return {**self.stage(product_id, pose, moving_id), 'relation': relation, 'frame': frame, 'edgeGapCm': gap_cm,
                'referenceId': self.object(reference_id)['referenceId']}

    def candidates(self, product_id, moving_id=None):
        self.product(product_id)
        near = self.camera or {'xCm': self.room['widthCm']/2, 'zCm': self.room['depthCm']/2, 'yawRad': 0}
        areas = self.room.get('spatial', {}).get('freeAreas') or ([{'minXcm': 0, 'maxXcm': self.room['widthCm'], 'minZcm': 0, 'maxZcm': self.room['depthCm']}] if not self.room.get('scan') else [])
        positions = [(near['xCm'] + dx, near['zCm'] + dz) for dx in (-300, -150, 0, 150, 300) for dz in (-300, -150, 0, 150, 300)]
        positions += [((a['minXcm']+a['maxXcm'])/2, (a['minZcm']+a['maxZcm'])/2) for a in areas]
        front = (-math.sin(near['yawRad']), -math.cos(near['yawRad']))
        positions.sort(key=lambda v: (sum((v[i]-near[k])*front[i] for i, k in enumerate(('xCm', 'zCm'))) < 0,
                                      math.hypot(v[0]-near['xCm'], v[1]-near['zCm'])))
        found = []
        for x, z in positions:
            for yaw in (0, math.pi/2):
                pose = {'xCm': x, 'zCm': z, 'yawRad': yaw}
                box = footprint(self.product(product_id), pose)
                delta = (near['xCm']-x, near['zCm']-z)
                # Keep a 40 cm walking margin around the viewer. Room-center
                # fallback has no physical viewer to protect.
                if self.camera and all(abs(sum(delta[j]*box['axes'][i][j] for j in (0, 1))) < box['half'][i]+40 for i in (0, 1)):
                    continue
                try:
                    self._checked(self._item(product_id, pose, moving_id))
                except SceneError:
                    continue
                if pose not in found:
                    found.append(pose)
                if len(found) == 8:
                    return found
        return found

    def review_camera(self):
        """Turn a valid interior camera toward the changed furniture, without teleporting."""
        camera = copy.deepcopy(self.camera)
        if not camera or camera.get('kind') != 'firstPerson':
            return camera
        ids = {c.get('instanceId') or c.get('instance', {}).get('instanceId') for c in self.commands}
        objects = [self.object(i['instanceId']) for i in self.instances if i['instanceId'] in ids]
        if not objects:
            return camera
        x = sum(o['pose']['xCm'] for o in objects)/len(objects)
        z = sum(o['pose']['zCm'] for o in objects)/len(objects)
        y = sum(o['dimensionsCm']['heightCm']/2 for o in objects)/len(objects)
        dx, dz = x-camera['xCm'], z-camera['zCm']
        camera['yawRad'] = math.atan2(-dx, -dz)
        camera['pitchRad'] = max(-1.3, min(1.3, math.atan2(y-camera['yCm'], max(1, math.hypot(dx, dz)))))
        return camera

    def remove(self, reference_id):
        obj = self.object(reference_id)
        if obj['type'] != 'furniture' or len(self.commands) >= 12:
            raise SceneError('validation', 'Only placed furniture can be removed, with at most 12 changes per request.')
        self.instances = [i for i in self.instances if i['instanceId'] != obj['referenceId']]
        self.commands.append({'type': 'remove', 'instanceId': obj['referenceId']})
        return {'ok': True, 'status': 'staged_not_saved', 'removedId': obj['referenceId']}
