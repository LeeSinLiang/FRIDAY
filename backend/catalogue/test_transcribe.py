"""Voice transcription. No network: the provider call is replaced with a recorded response.

Set TRANSCRIBE_LIVE_TEST=1 to also send the fixture recording to Deepgram (needs DEEPGRAM_API_KEY).
"""
import io
import json
import os
import unittest
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from catalogue import transcribe as speech
from catalogue.views import TranscribeThrottle

WAV = (Path(__file__).resolve().parent / "voice_fixtures" / "reading-chair.wav").read_bytes()
SECRET = "dg-test-secret-0123456789abcdef"
# The shape Deepgram's pre-recorded API answers with, trimmed to what is read.
RECORDED = {"metadata": {"request_id": "r", "duration": 2.4}, "results": {"channels": [{"alternatives": [
    {"transcript": "A reading chair under $400.", "confidence": 0.99}]}]}}
LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "transcribe-tests"}}
DEEPGRAM_ON = {"STT_PROVIDER": "deepgram", "TRANSCRIBE_BACKEND": "deepgram", "DEEPGRAM_API_KEY": SECRET}
OPENAI_ON = {"STT_PROVIDER": "openai", "OPENAI_API_KEY": SECRET}


def answering(payload):
    def respond(*args, **kwargs):
        response = mock.MagicMock()  # a fresh, unread body for every call, as a real connection gives
        response.__enter__.return_value = io.BytesIO(json.dumps(payload).encode())
        return response
    return mock.patch("catalogue.transcribe.urlopen", side_effect=respond)


@override_settings(CACHES=LOCMEM)
class TranscribeEndpointTests(SimpleTestCase):
    def setUp(self):
        cache.clear()

    def post(self, body=WAV, content_type="audio/wav"):
        return APIClient().post("/api/transcribe", body, content_type=content_type)

    def test_the_recording_goes_to_deepgram_from_the_server_and_the_text_comes_back(self):
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED) as urlopen:
            response = self.post(content_type="audio/webm;codecs=opus")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["text"], "A reading chair under $400.")
        self.assertEqual(response.json()["backend"], "deepgram")
        sent = urlopen.call_args.args[0]
        self.assertTrue(sent.full_url.startswith("https://api.deepgram.com/v1/listen?model=nova-3"))
        self.assertEqual(sent.get_header("Authorization"), f"Token {SECRET}")
        self.assertEqual(sent.get_header("Content-type"), "audio/webm;codecs=opus")
        self.assertEqual(sent.data, WAV)
        self.assertNotIn('keyterm', parse_qs(urlparse(sent.full_url).query))

    def test_wake_mode_adds_only_the_nova_three_wake_phrase_hint(self):
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED) as urlopen:
            response = APIClient().post('/api/transcribe?wake=1', WAV, content_type='audio/wav')
        self.assertEqual(response.status_code, 200)
        query = parse_qs(urlparse(urlopen.call_args.args[0].full_url).query)
        self.assertEqual(query['model'], ['nova-3'])
        self.assertEqual(query['keyterm'], ['Hey Friday'])
        self.assertNotIn('keywords', query)

    def test_openai_provider_sends_a_named_audio_file_and_bounded_domain_hints(self):
        with mock.patch.dict(os.environ, OPENAI_ON), answering({"text": "Find a brown sofa."}) as urlopen:
            response = APIClient().post('/api/transcribe?wake=1', WAV, content_type="audio/webm;codecs=opus")
        self.assertEqual((response.status_code, response.json()["text"], response.json()["backend"]),
                         (200, "Find a brown sofa.", "openai"))
        sent = urlopen.call_args.args[0]
        self.assertEqual(sent.full_url, speech.OPENAI_URL)
        self.assertEqual(sent.get_header("Authorization"), f"Bearer {SECRET}")
        self.assertIn("multipart/form-data; boundary=friday-", sent.get_header("Content-type"))
        self.assertIn(b'name="model"\r\n\r\ngpt-transcribe\r\n', sent.data)
        self.assertIn(b'name="languages[]"\r\n\r\nen\r\n', sent.data)
        self.assertIn(b'name="prompt"\r\n\r\n' + speech.OPENAI_WAKE_PROMPT.encode() + b'\r\n', sent.data)
        self.assertIn(b'name="keywords[]"\r\n\r\nHey Friday\r\n', sent.data)
        self.assertIn(b'name="keywords[]"\r\n\r\nHaussmann\r\n', sent.data)
        self.assertIn(b'name="file"; filename="recording.webm"', sent.data)
        self.assertIn(b"Content-Type: audio/webm\r\n\r\n" + WAV, sent.data)
        self.assertNotIn(SECRET.encode(), sent.data)

    def test_openai_plain_speak_does_not_add_the_wake_phrase_prompt(self):
        with mock.patch.dict(os.environ, OPENAI_ON), answering({"text": "Find a brown sofa."}) as urlopen:
            self.assertEqual(self.post().status_code, 200)
        self.assertNotIn(b'name="prompt"', urlopen.call_args.args[0].data)
        self.assertNotIn(b'\r\nHey Friday\r\n', urlopen.call_args.args[0].data)

    def test_the_key_never_reaches_the_page_or_the_logs(self):
        failure = HTTPError("https://api.deepgram.com/v1/listen", 401, f"bad key {SECRET}", {}, io.BytesIO(SECRET.encode()))
        with mock.patch.dict(os.environ, DEEPGRAM_ON), mock.patch("catalogue.transcribe.urlopen", side_effect=failure), \
                self.assertLogs("catalogue.views", level="WARNING") as logs:
            failed = self.post()
        with mock.patch.dict(os.environ, DEEPGRAM_ON):
            config = APIClient().get("/api/transcribe")
        self.assertEqual((failed.status_code, failed.json()), (503, {"error": "transcription_unavailable", "fallback": "browser"}))
        self.assertEqual(config.json(), {"backend": "deepgram"})
        for text in (failed.content.decode(), config.content.decode(), " ".join(logs.output)):
            self.assertNotIn(SECRET, text)
        self.assertEqual(logs.output, ["WARNING:catalogue.views:transcription unavailable: provider answered HTTP 401"])

    def test_browser_is_the_default_and_a_missing_key_falls_back_to_it(self):
        clean = {k: v for k, v in os.environ.items() if k not in
                 ("STT_PROVIDER", "TRANSCRIBE_BACKEND", "DEEPGRAM_API_KEY", "OPENAI_API_KEY")}
        for env in (clean, {**clean, "TRANSCRIBE_BACKEND": "deepgram"},
                    {**clean, "STT_PROVIDER": "openai"},
                    {**clean, "TRANSCRIBE_BACKEND": "browser", "DEEPGRAM_API_KEY": SECRET, "OPENAI_API_KEY": SECRET}):
            with mock.patch.dict(os.environ, env, clear=True), mock.patch("catalogue.transcribe.urlopen") as urlopen:
                self.assertEqual(APIClient().get("/api/transcribe").json(), {"backend": "browser"})
                self.assertEqual(self.post().status_code, 503)
                urlopen.assert_not_called()

    def test_explicit_provider_selection_does_not_silently_switch_vendors(self):
        with mock.patch.dict(os.environ, {**DEEPGRAM_ON, **OPENAI_ON}, clear=True):
            self.assertEqual(speech.backend_name(), "openai")
        with mock.patch.dict(os.environ, {**DEEPGRAM_ON, "STT_PROVIDER": "deepgram", "OPENAI_API_KEY": SECRET}, clear=True):
            self.assertEqual(speech.backend_name(), "deepgram")

    def test_provider_trouble_is_a_503_that_tells_the_page_to_fall_back(self):
        for failure in (URLError("no route"), TimeoutError()):
            with mock.patch.dict(os.environ, DEEPGRAM_ON), mock.patch("catalogue.transcribe.urlopen", side_effect=failure):
                self.assertEqual(self.post().json()["fallback"], "browser", type(failure).__name__)
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering({"results": {"channels": []}}):
            self.assertEqual(self.post().status_code, 503)

    def test_silence_is_an_empty_transcript_not_an_error(self):
        quiet = {"results": {"channels": [{"alternatives": [{"transcript": "", "confidence": 0}]}]}}
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(quiet):
            response = self.post()
        self.assertEqual((response.status_code, response.json()["text"]), (200, ""))

    def test_bad_uploads_are_refused_before_any_provider_call(self):
        with mock.patch.dict(os.environ, DEEPGRAM_ON), mock.patch("catalogue.transcribe.urlopen") as urlopen:
            self.assertEqual(self.post(content_type="application/json", body=b"{}").status_code, 415)
            self.assertEqual(self.post(body=b"").status_code, 415)
            self.assertEqual(self.post(body=b"x" * (speech.MAX_AUDIO_BYTES + 1)).status_code, 413)
            urlopen.assert_not_called()

    def test_it_is_throttled_per_client_and_the_throttle_fails_open(self):
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED), mock.patch.object(TranscribeThrottle, "rate", "2/min"):
            self.assertEqual([self.post().status_code for _ in range(3)], [200, 200, 429])
        cache.clear()
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED), \
                mock.patch("rest_framework.throttling.SimpleRateThrottle.allow_request", side_effect=ConnectionRefusedError()), \
                self.assertLogs("catalogue.views", level="WARNING") as logs:
            self.assertEqual(self.post().status_code, 200)
        self.assertEqual(logs.output, ["WARNING:catalogue.views:transcribe throttle unavailable, allowing the request: ConnectionRefusedError"])


@override_settings(CACHES=LOCMEM)
class SignedInBrowserTests(TestCase):
    """A shopper who has signed in must still be able to search, compile and speak. With DRF's default
    session authentication their POSTs were refused for a missing CSRF token before the view ran."""

    def setUp(self):
        cache.clear()
        self.client = APIClient(enforce_csrf_checks=True)
        self.client.force_login(get_user_model().objects.create_user("shopper", "s@example.com", "a-long-password-1"))

    def test_public_endpoints_work_for_a_signed_in_session_without_a_csrf_token(self):
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED):
            self.assertEqual(self.client.post("/api/transcribe", WAV, content_type="audio/wav").status_code, 200)
        with mock.patch("catalogue.views.compile_text") as compile_text:
            from catalogue.dsl.compile import CompileResult
            from catalogue.dsl.schema import Program
            compile_text.return_value = CompileResult(Program(find=[], place=[]), "model", 1)
            self.assertEqual(self.client.post("/api/compile", {"text": "a chair"}, format="json").status_code, 200)
        self.assertEqual(self.client.get("/api/search?limit=1").status_code, 200)

    def test_signing_in_does_not_lift_the_cap_on_the_endpoints_that_cost_money(self):
        # AnonRateThrottle ignores authenticated users. Anonymous views are throttled by client address
        # whoever is signed in, so an account is not a way around the limit.
        with mock.patch.dict(os.environ, DEEPGRAM_ON), answering(RECORDED), mock.patch.object(TranscribeThrottle, "rate", "2/min"):
            statuses = [self.client.post("/api/transcribe", WAV, content_type="audio/wav").status_code for _ in range(3)]
        self.assertEqual(statuses, [200, 200, 429])

    def test_only_the_three_public_views_are_anonymous(self):
        from catalogue import views
        for view in (views.search, views.compile_program, views.transcribe_audio):
            self.assertEqual(view.cls.authentication_classes, [], view.__name__)
        # Everything else keeps its authentication: a signed-in scene write without a CSRF token is still refused.
        refused = self.client.put("/api/scene/", {"baseRevision": 0, "instances": []}, format="json")
        self.assertEqual(refused.status_code, 403)


@unittest.skipUnless(os.getenv("TRANSCRIBE_LIVE_TEST") == "1", "live Deepgram test; set TRANSCRIBE_LIVE_TEST=1")
class LiveDeepgramTests(SimpleTestCase):
    def test_the_fixture_recording_is_transcribed(self):
        result = speech.transcribe(WAV, "audio/wav")
        self.assertEqual(result.backend, "deepgram")
        words = result.text.lower()
        self.assertIn("reading chair", words)
        self.assertIn("400", words.replace("four hundred", "400"))
