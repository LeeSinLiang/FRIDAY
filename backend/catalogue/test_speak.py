import io
import os
from unittest.mock import patch
from urllib.error import HTTPError

from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from .speak import VOICE_MODEL


@override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache', 'LOCATION': 'speak-tests'}})
class SpeakTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def test_configuration_names_actual_voice_and_never_exposes_key(self):
        with patch.dict(os.environ, {'DEEPGRAM_API_KEY': 'private-test-key'}):
            response = APIClient().get('/api/speak')
        self.assertEqual(response.json(), {'backend': 'deepgram', 'voice': 'Athena', 'model': VOICE_MODEL})
        self.assertNotIn('private-test-key', response.content.decode())

    def test_response_is_real_provider_audio_with_fixed_professional_voice(self):
        audio = io.BytesIO(b'ID3-test-audio')
        audio.headers = {'Content-Type': 'audio/mpeg'}
        with patch.dict(os.environ, {'DEEPGRAM_API_KEY': 'private-test-key'}), patch('catalogue.speak.urlopen', return_value=audio) as provider:
            response = APIClient().post('/api/speak', {'text': 'Your bedroom designs are ready.'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'ID3-test-audio')
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(response['X-Friday-Voice'], 'aura-2-athena-en')
        self.assertIn('model=aura-2-athena-en&encoding=mp3', provider.call_args.args[0].full_url)

    def test_provider_failure_is_sanitized_and_text_limits_precede_provider(self):
        with patch.dict(os.environ, {'DEEPGRAM_API_KEY': 'private-test-key'}), patch('catalogue.speak.urlopen') as provider:
            self.assertEqual(APIClient().post('/api/speak', {'text': 'x' * 1201}, format='json').status_code, 400)
            provider.assert_not_called()
            provider.side_effect = HTTPError('https://api.deepgram.com', 401, 'private-test-key', {}, None)
            response = APIClient().post('/api/speak', {'text': 'Hello.'}, format='json')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-test-key', response.content.decode())

    def test_missing_provider_key_and_empty_text_fail_without_request(self):
        with patch.dict(os.environ, {'DEEPGRAM_API_KEY': ''}), patch('catalogue.speak.urlopen') as provider:
            self.assertEqual(APIClient().post('/api/speak', {'text': 'Hello.'}, format='json').status_code, 503)
            self.assertEqual(APIClient().post('/api/speak', {'text': '  '}, format='json').status_code, 400)
            provider.assert_not_called()
