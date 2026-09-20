import logging
import os

from django.db import DatabaseError
from elasticsearch import ApiError, TransportError
from rest_framework.decorators import api_view, authentication_classes, parser_classes, permission_classes, throttle_classes
from rest_framework.parsers import BaseParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from catalogue import es, memory
from catalogue import transcribe as speech
from catalogue.dsl.compile import MAX_INPUT_CHARS, compile_text
from catalogue.dsl.render import render
from catalogue.dsl.schema import TextClause
from catalogue.facets import MODELS_ALL, MODELS_FIRST, MODELS_ONLY
from catalogue.feed import load_catalogue
from catalogue.mock.room import MOCK_ROOM, room_refs
from catalogue.params import SearchQuery, parse_search_params
from catalogue.types import SearchResponse, to_wire

logger = logging.getLogger(__name__)

# search, compile_program and transcribe_audio are DELIBERATELY ANONYMOUS. Do not "fix" this back.
# They are public and stateless: the catalogue, a sentence turned into a Program, audio turned into
# text. None needs to know who is asking. With DRF's default SessionAuthentication a shopper who had
# signed in got every POST here refused for a missing CSRF token before the view ran. Being anonymous
# also makes the throttles below apply to everyone: AnonRateThrottle skips authenticated users
# entirely, so a signed-in session used to bypass the cap on the two endpoints that cost money.
# Only these three views. Scene, account and checkout endpoints keep their authentication.
PUBLIC: list = []

BACKEND_HEADER = "X-Search-Backend"
RESULTS_HEADER = "X-Search-Results"  # "with-model", "model-first" or "all": what was returned, and in what order


def results_mode() -> str:
    """How listings with a real 3D model are treated in what search returns. ONE LINE in .env:

        SEARCH_RESULTS_REQUIRE_MODEL=boost  everything, them first (the default, also when empty or unset):
                                            a full list with what can be placed in 3D on top, as a shop
                                            does with what is in stock
        SEARCH_RESULTS_REQUIRE_MODEL=1      only them
        SEARCH_RESULTS_REQUIRE_MODEL=0      everything, plain order

    Counting is never affected: facets, fits_room and fits_room_of cover every match in all three.
    """
    value = os.getenv("SEARCH_RESULTS_REQUIRE_MODEL", "").strip().lower()
    return MODELS_ALL if value == "0" else MODELS_ONLY if value in ("1", "only") else MODELS_FIRST


def run_search(query: SearchQuery) -> tuple[SearchResponse, str]:
    """Search with the configured backend. Elasticsearch failures fall back to memory, never to an error."""
    models = query.models or results_mode()
    if os.getenv("SEARCH_BACKEND", "memory") == "elastic":
        try:
            return es.search(query.find, query.limit, query.offset, models), "elastic"
        except ApiError as exc:
            logger.warning("elastic search failed, using memory: HTTP %s", exc.status_code)
        except (TransportError, KeyError) as exc:
            logger.warning("elastic search unavailable, using memory: %s", type(exc).__name__)
        return memory.search(load_catalogue(), query.find, query.limit, query.offset, models), "memory-fallback"
    return memory.search(load_catalogue(), query.find, query.limit, query.offset, models), "memory"


# Browsing the catalogue is public, like any storefront. Cart and checkout auth are decided elsewhere.
@api_view(["GET"])
@authentication_classes(PUBLIC)
@permission_classes([AllowAny])
def search(request):
    try:
        query = parse_search_params(request.query_params)
    except ValueError as exc:
        return Response({"error": "invalid_search_params", "detail": str(exc)}, status=400)
    result, backend = run_search(query)
    returned = {MODELS_ONLY: "with-model", MODELS_FIRST: "model-first", MODELS_ALL: "all"}[query.models or results_mode()]
    return Response(to_wire(result), headers={BACKEND_HEADER: backend, RESULTS_HEADER: returned})


def text_search_has_results(words: list[str]) -> bool:
    """Whether a text search for these words finds any listing. Only used to shape the compile fallback,
    which must work with the model and Elasticsearch both down, so it asks the memory catalogue."""
    clause = TextClause(k="text", q=" ".join(words))
    return any(memory.matches(listing, [clause]) for listing in load_catalogue())


class FailOpenThrottle(AnonRateThrottle):
    """Per-client cap for an endpoint that spends money. If the counter cannot be reached the request
    is allowed: a rate limiter that can take down the endpoint it protects is a worse trade than a
    briefly unthrottled one, and each request is bounded on its own."""

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except (DatabaseError, OSError) as exc:
            logger.warning("%s throttle unavailable, allowing the request: %s", self.scope, type(exc).__name__)
            return True


class CompileThrottle(FailOpenThrottle):
    scope = "compile"
    rate = "30/min"


class TranscribeThrottle(FailOpenThrottle):
    scope = "transcribe"
    rate = "20/min"


class AudioParser(BaseParser):
    """The recording arrives as the raw request body, whatever audio type the browser produced."""

    media_type = "*/*"

    def parse(self, stream, media_type=None, parser_context=None):
        # One byte over the cap is enough to know it is too large, without reading an upload of any size.
        return stream.read(speech.MAX_AUDIO_BYTES + 1)


# Public for the same reason as search. Each request is bounded (length cap, one retry, small output)
# and the throttle bounds the total, so an anonymous caller cannot run up the model bill.
@api_view(["POST"])
@authentication_classes(PUBLIC)
@permission_classes([AllowAny])
@throttle_classes([CompileThrottle])
def compile_program(request):
    text = request.data.get("text") if isinstance(request.data, dict) else None
    if not isinstance(text, str) or len(text) > MAX_INPUT_CHARS:
        return Response({"error": "invalid_text", "detail": f"text must be a string of at most {MAX_INPUT_CHARS} characters"},
                        status=400)
    # The mock room stands in until the space lane ships a Room; only its ids reach the model.
    refs = room_refs(MOCK_ROOM)
    result = compile_text(text, refs, text_search_has_results)
    return Response({
        "program": to_wire(result.program),
        "chips": render(result.program, refs),
        "source": result.source,
        "ms": result.ms,
    })


@api_view(["GET", "POST"])
@authentication_classes(PUBLIC)
@permission_classes([AllowAny])
@throttle_classes([TranscribeThrottle])
@parser_classes([AudioParser])
def transcribe_audio(request):
    """GET says which backend the page should use. POST turns one short recording into text.

    The page never talks to the speech provider: it has no key and learns only "deepgram" or "browser".
    """
    if request.method == "GET":
        return Response({"backend": speech.backend_name()})
    content_type = (request.content_type or "").split(";")[0].strip().lower()
    audio = request.data if isinstance(request.data, bytes) else b""
    if not content_type.startswith(("audio/", "video/webm")) or not audio:
        return Response({"error": "invalid_audio", "detail": "Send the recording as the request body with an audio content type."}, status=415)
    if len(audio) > speech.MAX_AUDIO_BYTES:
        return Response({"error": "audio_too_large", "detail": "Keep it to a sentence."}, status=413)
    try:
        result = speech.transcribe(audio, request.content_type)
    except speech.TranscriptionUnavailable as exc:
        logger.warning("transcription unavailable: %s", exc)
        return Response({"error": "transcription_unavailable", "fallback": "browser"}, status=503)
    return Response({"text": result.text, "backend": result.backend, "ms": result.ms})
