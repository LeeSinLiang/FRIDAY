import logging
import os

from elasticsearch import ApiError, TransportError
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle

from catalogue import es, memory
from catalogue.dsl.compile import MAX_INPUT_CHARS, compile_text
from catalogue.dsl.render import render
from catalogue.dsl.schema import TextClause
from catalogue.feed import load_catalogue
from catalogue.mock.room import MOCK_ROOM, room_refs
from catalogue.params import SearchQuery, parse_search_params
from catalogue.types import SearchResponse, to_wire

logger = logging.getLogger(__name__)

BACKEND_HEADER = "X-Search-Backend"


def run_search(query: SearchQuery) -> tuple[SearchResponse, str]:
    """Search with the configured backend. Elasticsearch failures fall back to memory, never to an error."""
    if os.getenv("SEARCH_BACKEND", "memory") == "elastic":
        try:
            return es.search(query.find, query.limit, query.offset), "elastic"
        except ApiError as exc:
            logger.warning("elastic search failed, using memory: HTTP %s", exc.status_code)
        except (TransportError, KeyError) as exc:
            logger.warning("elastic search unavailable, using memory: %s", type(exc).__name__)
        return memory.search(load_catalogue(), query.find, query.limit, query.offset), "memory-fallback"
    return memory.search(load_catalogue(), query.find, query.limit, query.offset), "memory"


# Browsing the catalogue is public, like any storefront. Cart and checkout auth are decided elsewhere.
@api_view(["GET"])
@permission_classes([AllowAny])
def search(request):
    try:
        query = parse_search_params(request.query_params)
    except ValueError as exc:
        return Response({"error": "invalid_search_params", "detail": str(exc)}, status=400)
    result, backend = run_search(query)
    return Response(to_wire(result), headers={BACKEND_HEADER: backend})


def text_search_has_results(words: list[str]) -> bool:
    """Whether a text search for these words finds any listing. Only used to shape the compile fallback,
    which must work with the model and Elasticsearch both down, so it asks the memory catalogue."""
    clause = TextClause(k="text", q=" ".join(words))
    return any(memory.matches(listing, [clause]) for listing in load_catalogue())


class CompileThrottle(AnonRateThrottle):
    """Per-client cap on the one endpoint that spends money. Search stays unthrottled."""

    scope = "compile"
    rate = "30/min"


# Public for the same reason as search. Each request is bounded (length cap, one retry, small output)
# and the throttle bounds the total, so an anonymous caller cannot run up the model bill.
@api_view(["POST"])
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
