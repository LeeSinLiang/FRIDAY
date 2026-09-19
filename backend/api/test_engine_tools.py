from unittest.mock import patch

from django.db import OperationalError
from django.test import TestCase

from .capture_service import claim_capture, complete_capture
from .engine_tools import read_scene_capture, request_scene_capture, try_place
from .test_engine import png


class EngineToolTests(TestCase):
    def setUp(self):
        self.session = 'trusted-session'
        self.item = {'instanceId': 'one', 'productId': 'test-sofa', 'pose': {'xCm': 200, 'zCm': 150, 'yawRad': 0}}

    def test_placement_failures_return_structured_reason(self):
        invalid = {**self.item, 'pose': {**self.item['pose'], 'xCm': -1}}
        result = try_place(self.session, invalid, 0, 'bad')
        self.assertFalse(result['ok'])
        self.assertEqual(result['error']['details']['issues'][0]['code'], 'out_of_bounds')
        self.assertTrue(try_place(self.session, self.item, 0, 'good')['ok'])
        with patch('api.engine_tools.attempt_placement', side_effect=OperationalError('locked')):
            self.assertEqual(try_place(self.session, self.item, 1, 'busy')['error']['code'], 'unavailable')

    def test_capture_pending_ready_inline_image_and_isolation(self):
        result = request_scene_capture(self.session, 0, 'screenshot', view='top', width=256, height=256)
        self.assertTrue(result['ok'])
        identifier = result['captureId']
        pending = read_scene_capture(self.session, identifier, True)
        self.assertTrue(pending['ok'])
        self.assertEqual(pending['status'], 'pending')
        self.assertNotIn('imageDataUrl', pending)
        job = claim_capture(self.session)['job']
        data_url = png()
        complete_capture(self.session, identifier, {'leaseToken': job['leaseToken'], 'imageDataUrl': data_url})
        self.assertEqual(read_scene_capture(self.session, identifier, True)['imageDataUrl'], data_url)
        self.assertNotIn('imageDataUrl', read_scene_capture(self.session, identifier))
        denied = read_scene_capture('another-session', identifier, True)
        self.assertFalse(denied['ok'])
        self.assertEqual(denied['error']['code'], 'not_found')

    def test_capture_failed_invalid_and_queue_full(self):
        identifier = request_scene_capture(self.session, 0, 'screenshot')['captureId']
        job = claim_capture(self.session)['job']
        complete_capture(self.session, identifier, {'leaseToken': job['leaseToken'], 'error': {'code': 'webgl', 'message': 'Renderer unavailable'}})
        failed = read_scene_capture(self.session, identifier, True)
        self.assertFalse(failed['ok'])
        self.assertEqual(failed['error']['code'], 'webgl')
        for capture_id, include_image in [('not-a-uuid', False), (None, False), (identifier, 'yes')]:
            self.assertEqual(read_scene_capture(self.session, capture_id, include_image)['error']['code'], 'validation')
        for i in range(4):
            self.assertTrue(request_scene_capture(self.session, 0, str(i))['ok'])
        self.assertEqual(request_scene_capture(self.session, 0, 'full')['error']['code'], 'capture_queue_full')
