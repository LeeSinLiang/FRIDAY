import copy
import math
from unittest.mock import patch

from django.test import Client, TestCase

from .models import SceneCommandReceipt, SceneLayout
from .scene_service import SceneError, fixtures, validate_instances


class SceneTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        response = self.client.get('/api/scene/')
        self.assertEqual(response.status_code, 200)
        self.token = self.client.cookies['csrftoken'].value
        self.item = {'instanceId': 'one', 'productId': 'test-sofa', 'pose': {'xCm': 200, 'zCm': 150, 'yawRad': 0}}

    def put(self, instances, revision=0):
        return self.client.put('/api/scene/', {'baseRevision': revision, 'instances': instances}, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def commands(self, commands, revision=0, command_id='batch-1'):
        return self.client.post('/api/scene/commands/', {'baseRevision': revision, 'commandId': command_id, 'commands': commands}, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def test_csrf_required_for_anonymous_writes(self):
        for url, method, payload in [('/api/scene/', 'put', {'baseRevision': 0, 'instances': []}), ('/api/scene/commands/', 'post', {'baseRevision': 0, 'commandId': 'x', 'commands': []})]:
            response = getattr(self.client, method)(url, payload, content_type='application/json')
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()['error']['code'], 'csrf')
        self.assertEqual(self.put([self.item]).status_code, 200)

    def test_snapshot_persistence_session_isolation_and_revision(self):
        saved = self.put([self.item])
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()['revision'], 1)
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [self.item])
        other = Client(enforce_csrf_checks=True)
        self.assertEqual(other.get('/api/scene/').json()['instances'], [])
        self.assertEqual(SceneLayout.objects.count(), 2)
        self.assertEqual(self.put([], revision=0).status_code, 409)
        self.assertEqual(self.put([self.item], revision=1).json()['revision'], 1)

    def test_invalid_snapshots_do_not_modify_scene(self):
        cases = [
            [dict(self.item, pose={'xCm': True, 'zCm': 100, 'yawRad': 0})],
            [dict(self.item, pose={'xCm': -10, 'zCm': 100, 'yawRad': 0})],
            [self.item, dict(self.item, instanceId='two')],
            [dict(self.item, productId='unknown')],
            [self.item] * 101,
        ]
        for items in cases:
            self.assertEqual(self.put(items).status_code, 400)
        self.assertEqual(self.client.get('/api/scene/').json()['revision'], 0)
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [])

    def test_atomic_batch_and_idempotency_with_stale_retry(self):
        commands = [{'type': 'add', 'instance': self.item}, {'type': 'setPose', 'instanceId': 'one', 'pose': {'xCm': 250, 'zCm': 200, 'yawRad': math.pi / 2}}]
        first = self.commands(commands)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()['revision'], 1)
        self.assertEqual(self.commands(commands).json(), first.json())
        self.assertEqual(SceneCommandReceipt.objects.count(), 1)
        self.assertEqual(self.commands([{'type': 'remove', 'instanceId': 'one'}]).status_code, 409)
        self.assertEqual(self.commands(commands, command_id='new').status_code, 409)
        removed = self.commands([{'type': 'remove', 'instanceId': 'one'}], revision=1, command_id='remove')
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(removed.json()['instances'], [])
        self.assertEqual(self.commands(commands).json(), first.json())

    def test_failed_batch_rolls_back_prior_commands_and_receipt(self):
        response = self.commands([{'type': 'add', 'instance': self.item}, {'type': 'setPose', 'instanceId': 'one', 'pose': {'xCm': -1, 'zCm': 0, 'yawRad': 0}}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get('/api/scene/').json()['instances'], [])
        self.assertEqual(SceneCommandReceipt.objects.count(), 0)

    def test_touch_rotated_edges_nonfinite_and_height(self):
        touching = [self.item, dict(self.item, instanceId='two', pose={'xCm': 420, 'zCm': 150, 'yawRad': 0})]
        self.assertEqual(validate_instances(touching), touching)
        rotated = dict(self.item, pose={'xCm': 47.5, 'zCm': 110, 'yawRad': math.pi / 2})
        self.assertEqual(validate_instances([rotated]), [rotated])
        for value in [float('inf'), float('nan'), False, 10 ** 400]:
            with self.assertRaises(SceneError):
                validate_instances([dict(self.item, pose={'xCm': value, 'zCm': 150, 'yawRad': 0})])
        data = copy.deepcopy(fixtures())
        data['products'][0]['heightCm'] = 300
        with patch('api.scene_service.fixtures', return_value=data), self.assertRaises(SceneError):
            validate_instances([self.item])

    def test_command_limits_and_shape(self):
        for commands in [[], [{}] * 201, [{'type': 'remove', 'instanceId': 'missing'}], [{'type': 'add', 'instance': None}], [{'type': 'explode'}]]:
            self.assertEqual(self.commands(commands).status_code, 400)

    def test_atomic_restore_can_replace_100_items_without_exceeding_instance_limit(self):
        data = copy.deepcopy(fixtures())
        for product in data['products']:
            product.update(widthCm=1, depthCm=1, heightCm=1)
        items = [dict(self.item, instanceId=str(index), pose={'xCm': 20 + index * 5, 'zCm': 100, 'yawRad': 0}) for index in range(100)]
        restored = [dict(item, pose={**item['pose'], 'zCm': 200}) for item in items]
        with patch('api.scene_service.fixtures', return_value=data):
            self.assertEqual(self.put(items).status_code, 200)
            commands = [{'type': 'remove', 'instanceId': item['instanceId']} for item in items] + [{'type': 'add', 'instance': item} for item in restored]
            response = self.commands(commands, revision=1)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['instances'], restored)
            self.assertEqual(self.commands(commands + [commands[-1]], revision=2, command_id='oversized').status_code, 400)

    def test_sat_does_not_confuse_overlapping_aabbs_with_collision(self):
        data = copy.deepcopy(fixtures())
        data['products'][0]['widthCm'] = 200
        data['products'][0]['depthCm'] = 50
        angle = math.pi / 4
        first = dict(self.item, pose={'xCm': 200, 'zCm': 200, 'yawRad': angle})
        second = dict(self.item, instanceId='two', pose={'xCm': 200 + 60 / math.sqrt(2), 'zCm': 200 + 60 / math.sqrt(2), 'yawRad': angle})
        with patch('api.scene_service.fixtures', return_value=data):
            self.assertEqual(validate_instances([first, second]), [first, second])

    def test_receipts_are_scoped_to_session(self):
        payload = {'baseRevision': 0, 'commandId': 'shared-id', 'commands': [{'type': 'add', 'instance': self.item}]}
        first = self.client.post('/api/scene/commands/', payload, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)
        self.assertEqual(first.status_code, 200)
        other = Client(enforce_csrf_checks=True)
        other.get('/api/scene/')
        token = other.cookies['csrftoken'].value
        second = other.post('/api/scene/commands/', payload, content_type='application/json', HTTP_X_CSRFTOKEN=token)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(SceneCommandReceipt.objects.count(), 2)
