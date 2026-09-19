import base64
import struct
import zlib
from datetime import timedelta

from django.test import Client, TestCase
from django.utils import timezone

from .models import SceneCapture, SceneCommandReceipt


def png(width=256, height=256):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    content = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
    content += chunk(b'IDAT', zlib.compress((b'\0' + b'\0\0\0\xff' * width) * height)) + chunk(b'IEND', b'')
    return 'data:image/png;base64,' + base64.b64encode(content).decode()


class EngineTests(TestCase):
    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.client.get('/api/scene/')
        self.token = self.client.cookies['csrftoken'].value
        self.item = {'instanceId': 'one', 'productId': 'test-sofa', 'pose': {'xCm': 200, 'zCm': 150, 'yawRad': 0}}

    def post(self, url, data):
        return self.client.post(url, data, content_type='application/json', HTTP_X_CSRFTOKEN=self.token)

    def place(self, **extra):
        return self.post('/api/scene/placement/', {'commandId': 'place', 'baseRevision': 0, 'instance': self.item, **extra})

    def enqueue(self, **extra):
        return self.post('/api/scene/captures/', {'requestId': 'capture', 'baseRevision': 0, 'view': 'top', 'width': 256, 'height': 256, **extra})

    def claim(self):
        return self.post('/api/scene/captures/claim/', {}).json()['job']

    def test_placement_dry_run_apply_idempotence_and_move(self):
        result = self.place(dryRun=True)
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json()['applied'])
        self.assertEqual(result.json()['instances'], [])
        self.assertEqual(SceneCommandReceipt.objects.count(), 0)
        applied = self.place().json()
        self.assertTrue(applied['ok'])
        self.assertTrue(applied['applied'])
        self.assertEqual(applied['revision'], 1)
        self.assertEqual(self.place().json(), applied)
        moved = {**self.item, 'pose': {**self.item['pose'], 'xCm': 250}}
        result = self.place(instance=moved, baseRevision=1, commandId='move')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['instances'][0], moved)
        self.assertEqual(self.place(baseRevision=2, commandId='wrong', instance={**self.item, 'productId': 'test-chair'}).json()['error']['code'], 'product_mismatch')

    def test_structured_placement_failure_and_no_mutation(self):
        response = self.place(instance={**self.item, 'pose': {**self.item['pose'], 'xCm': -1}})
        self.assertEqual(response.status_code, 400)
        self.assertFalse(response.json()['ok'])
        issue = response.json()['error']['details']['issues'][0]
        self.assertEqual(issue['code'], 'out_of_bounds')
        self.assertLess(issue['bounds']['minX'], 0)
        self.place()
        response = self.place(instance={**self.item, 'instanceId': 'two'}, baseRevision=1, commandId='collision')
        self.assertEqual(response.json()['error']['details']['issues'][0]['conflictingInstanceIds'], ['one'])
        self.assertEqual(self.client.get('/api/scene/').json()['revision'], 1)
        self.assertEqual(SceneCommandReceipt.objects.count(), 1)

    def test_capture_frozen_snapshot_png_and_session_scope(self):
        queued = self.enqueue()
        self.assertEqual(queued.status_code, 202)
        identifier = queued.json()['captureId']
        self.place()
        job = self.claim()
        self.assertEqual(job['snapshot']['instances'], [])
        self.assertEqual(job['revision'], 0)
        self.assertIsNone(self.claim())
        result = self.post(f'/api/scene/captures/{identifier}/complete/', {'leaseToken': job['leaseToken'], 'imageDataUrl': png(), 'modelWarnings': ['Test proxy']})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()['status'], 'ready')
        image = self.client.get(result.json()['imageUrl'])
        self.assertEqual(image['Content-Type'], 'image/png')
        self.assertTrue(image.content.startswith(b'\x89PNG'))
        other = Client()
        self.assertEqual(other.get(f'/api/scene/captures/{identifier}/').status_code, 404)
        self.assertEqual(other.get(result.json()['imageUrl']).status_code, 404)

    def test_expired_lease_reclaim_old_token_rejected_and_deadline_timeout(self):
        identifier = self.enqueue().json()['captureId']
        first = self.claim()
        SceneCapture.objects.filter(pk=identifier).update(lease_until=timezone.now() - timedelta(seconds=1))
        second = self.claim()
        self.assertNotEqual(first['leaseToken'], second['leaseToken'])
        rejected = self.post(f'/api/scene/captures/{identifier}/complete/', {'leaseToken': first['leaseToken'], 'imageDataUrl': png()})
        self.assertEqual(rejected.status_code, 409)
        SceneCapture.objects.filter(pk=identifier).update(expires_at=timezone.now() - timedelta(seconds=1))
        status = self.client.get(f'/api/scene/captures/{identifier}/').json()
        self.assertEqual(status['status'], 'failed')
        self.assertEqual(status['error']['code'], 'capture_timeout')
        self.assertIsNone(self.claim())

    def test_capture_validation_limits_duplicate_requests_and_csrf(self):
        original = self.enqueue().json()
        self.assertEqual(self.enqueue().json(), original)
        self.assertEqual(self.enqueue(view='perspective').status_code, 409)
        for options in [{'width': 10}, {'width': True}, {'width': 1536, 'height': 1536}, {'camera': {}}, {'view': 'perspective', 'camera': {'azimuthDeg': 0, 'elevationDeg': 90}}]:
            self.assertEqual(self.enqueue(requestId='invalid', **options).status_code, 400)
        for i in range(3):
            self.assertEqual(self.enqueue(requestId=str(i)).status_code, 202)
        self.assertEqual(self.enqueue(requestId='full').status_code, 429)
        for url, data in [('/api/scene/placement/', {}), ('/api/scene/captures/', {}), ('/api/scene/captures/claim/', {}), (f"/api/scene/captures/{original['captureId']}/complete/", {})]:
            self.assertEqual(self.client.post(url, data, content_type='application/json').status_code, 403)

    def test_png_dimensions_signature_checksum_and_browser_failure(self):
        identifier = self.enqueue().json()['captureId']
        job = self.claim()
        for data in ['data:image/png;base64,bad', png(512), png()[:-4] + 'AAAA']:
            response = self.post(f'/api/scene/captures/{identifier}/complete/', {'leaseToken': job['leaseToken'], 'imageDataUrl': data})
            self.assertEqual(response.status_code, 400)
        response = self.post(f'/api/scene/captures/{identifier}/complete/', {'leaseToken': job['leaseToken'], 'error': {'code': 'webgl', 'message': 'WebGL unavailable'}})
        self.assertEqual(response.json()['status'], 'failed')
        self.assertEqual(response.json()['error']['code'], 'webgl')

    def test_completed_capture_storage_is_bounded(self):
        identifier = self.enqueue().json()['captureId']
        template = SceneCapture.objects.get(pk=identifier)
        for i in range(22):
            SceneCapture.objects.create(scene=template.scene, request_id=f'old-{i}', payload_hash='x', snapshot={}, revision=0, view='top', width=256, height=256, expires_at=timezone.now(), status='failed')
        self.enqueue(requestId='cleanup')
        self.assertEqual(SceneCapture.objects.filter(status='failed').count(), 20)

    def test_move_collision_identifies_attempted_object_and_obstacle(self):
        self.place()
        other = {'instanceId': 'two', 'productId': 'test-chair', 'pose': {'xCm': 450, 'zCm': 300, 'yawRad': 0}}
        self.assertEqual(self.place(instance=other, commandId='chair', baseRevision=1).status_code, 200)
        move = {**self.item, 'pose': {'xCm': 450, 'zCm': 300, 'yawRad': 0}}
        response = self.place(instance=move, commandId='move', baseRevision=2)
        self.assertEqual(response.status_code, 400)
        issue = response.json()['error']['details']['issues'][0]
        self.assertEqual(issue['instanceId'], 'one')
        self.assertEqual(issue['conflictingInstanceIds'], ['two'])
        self.assertIn('Oak lounge chair', response.json()['error']['message'])
        self.assertEqual(self.client.get('/api/scene/').json()['revision'], 2)
