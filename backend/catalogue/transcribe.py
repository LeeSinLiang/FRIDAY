"""Speech -> text, behind one interface. The browser never sees the provider or its key.

STT_PROVIDER=openai or deepgram sends recorded audio to that provider from the server.
STT_PROVIDER=browser (the default) means the server does nothing and the page uses the Web Speech
API instead: no key, no dependency, the fallback that always works. TRANSCRIBE_BACKEND remains a
compatibility alias. Either way the transcript goes to the same /api/compile as typed text. Voice is
an input method, not a feature.
"""
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM_MODEL = "nova-3"
OPENAI_URL = "https://api.openai.com/v1/audio/transcriptions"
OPENAI_MODEL = "gpt-transcribe"
REQUEST_TIMEOUT_S = 10
MAX_AUDIO_BYTES = 2 * 1024 * 1024  # about a minute of Opus; a sentence is a few seconds
BACKENDS = ("openai", "deepgram", "browser")
DOMAIN_KEYWORDS = (
    "Haussmann", "furniture", "brown sofa", "cream sofa", "bedroom",
    "nightstand", "armchair", "ottoman", "pouf", "wardrobe", "dresser", "bookcase",
    "rug", "lamp", "lock in", "checkout",
)
OPENAI_WAKE_PROMPT = "The audio is an English voice command that may begin with the exact wake phrase 'Hey Friday'."


class TranscriptionUnavailable(Exception):
    """The provider could not be used. Carries nothing that came from the provider or the key."""


@dataclass(frozen=True)
class Transcript:
    text: str
    backend: str
    ms: int


def backend_name() -> str:
    """Return the provider that can actually answer, never merely the requested provider."""
    chosen = os.getenv("STT_PROVIDER", "").strip().lower() or os.getenv("TRANSCRIBE_BACKEND", "browser").strip().lower()
    if chosen == "openai" and os.getenv("OPENAI_API_KEY"):
        return "openai"
    if chosen == "deepgram" and os.getenv("DEEPGRAM_API_KEY"):
        return "deepgram"
    return "browser"


def _deepgram(audio: bytes, content_type: str, *, wake_hint: bool = False) -> str:
    options = {"model": DEEPGRAM_MODEL, "smart_format": "true", "language": "en"}
    if wake_hint:
        # Nova-3 keyterm prompting accepts an encoded multi-word phrase. Keep this
        # hint scoped to the explicitly enabled wake mode, not ordinary dictation.
        options['keyterm'] = 'Hey Friday'
    query = urlencode(options)
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


def _audio_extension(content_type: str) -> str:
    base = content_type.split(";", 1)[0].strip().lower()
    try:
        return {
            "audio/flac": "flac", "audio/mpeg": "mp3", "audio/mp3": "mp3",
            "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/ogg": "ogg",
            "audio/wav": "wav", "audio/x-wav": "wav", "audio/webm": "webm",
            "video/webm": "webm",
        }[base]
    except KeyError:
        raise TranscriptionUnavailable("unsupported audio type") from None


def _multipart(audio: bytes, content_type: str, *, wake_hint: bool = False) -> tuple[bytes, str]:
    """Build the small multipart upload without adding an SDK dependency."""
    boundary = f"friday-{secrets.token_hex(16)}"
    marker = f"--{boundary}\r\n".encode()
    chunks: list[bytes] = []

    def field(name: str, value: str):
        chunks.extend((marker, f'Content-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()))

    field("model", OPENAI_MODEL)
    field("languages[]", "en")
    if wake_hint:
        field("prompt", OPENAI_WAKE_PROMPT)
    for keyword in (("Hey Friday",) if wake_hint else ()) + DOMAIN_KEYWORDS:
        field("keywords[]", keyword)
    base_type = content_type.split(";", 1)[0].strip().lower()
    filename = f"recording.{_audio_extension(base_type)}"
    chunks.extend((
        marker,
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
        f"Content-Type: {base_type}\r\n\r\n".encode(), audio, b"\r\n",
        f"--{boundary}--\r\n".encode(),
    ))
    return b"".join(chunks), boundary


def _openai(audio: bytes, content_type: str, *, wake_hint: bool = False) -> str:
    body, boundary = _multipart(audio, content_type, wake_hint=wake_hint)
    request = Request(OPENAI_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    })
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_S) as response:
            result = json.load(response)
    except HTTPError as exc:
        raise TranscriptionUnavailable(f"provider answered HTTP {exc.code}") from None
    except (URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise TranscriptionUnavailable(type(exc).__name__) from None
    text = result.get("text") if isinstance(result, dict) else None
    if not isinstance(text, str):
        raise TranscriptionUnavailable("unexpected response shape")
    return text.strip()


def transcribe(audio: bytes, content_type: str, *, wake_hint: bool = False) -> Transcript:
    """Transcribe one short recording.

    Raises:
        TranscriptionUnavailable: the backend is `browser`, or the provider failed.
    """
    backend = backend_name()
    if backend == "browser":
        raise TranscriptionUnavailable("server transcription is off")
    started = time.perf_counter()
    text = (_openai(audio, content_type, wake_hint=wake_hint) if backend == "openai"
            else _deepgram(audio, content_type, wake_hint=wake_hint))
    return Transcript(text=text, backend=backend, ms=round((time.perf_counter() - started) * 1000))
