"""Speech -> text, behind one interface. The browser never sees the provider or its key.

TRANSCRIBE_BACKEND=deepgram sends recorded audio to Deepgram's pre-recorded API from the server.
TRANSCRIBE_BACKEND=browser (the default) means the server does nothing and the page uses the Web
Speech API instead: no key, no dependency, the fallback that always works. Either way the transcript
goes to the same /api/compile as typed text. Voice is an input method, not a feature.
"""
import json
import logging
import os
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_MODEL = "nova-3"
REQUEST_TIMEOUT_S = 10
MAX_AUDIO_BYTES = 2 * 1024 * 1024  # about a minute of Opus; a sentence is a few seconds
BACKENDS = ("deepgram", "browser")


class TranscriptionUnavailable(Exception):
    """The provider could not be used. Carries nothing that came from the provider or the key."""


@dataclass(frozen=True)
class Transcript:
    text: str
    backend: str
    ms: int


def backend_name() -> str:
    """The configured backend. Deepgram without a key quietly becomes browser, so a missing secret
    degrades the feature instead of breaking it."""
    chosen = os.getenv("TRANSCRIBE_BACKEND", "browser").strip().lower()
    if chosen == "deepgram" and os.getenv("DEEPGRAM_API_KEY"):
        return "deepgram"
    return "browser"


def _deepgram(audio: bytes, content_type: str) -> str:
    query = urlencode({"model": DEEPGRAM_MODEL, "smart_format": "true", "language": "en"})
    request = Request(f"{DEEPGRAM_URL}?{query}", data=audio, method="POST", headers={
        "Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}", "Content-Type": content_type})
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            body = json.load(response)
    except HTTPError as exc:
        # Status only. The response body and the request headers stay out of logs and errors.
        raise TranscriptionUnavailable(f"provider answered HTTP {exc.code}") from None
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise TranscriptionUnavailable(type(exc).__name__) from None
    try:
        return body["results"]["channels"][0]["alternatives"][0]["transcript"].strip()
    except (KeyError, IndexError, TypeError, AttributeError):
        raise TranscriptionUnavailable("unexpected response shape") from None


def transcribe(audio: bytes, content_type: str) -> Transcript:
    """Transcribe one short recording.

    Raises:
        TranscriptionUnavailable: the backend is `browser`, or the provider failed.
    """
    if backend_name() != "deepgram":
        raise TranscriptionUnavailable("server transcription is off")
    started = time.perf_counter()
    text = _deepgram(audio, content_type)
    return Transcript(text=text, backend="deepgram", ms=round((time.perf_counter() - started) * 1000))
