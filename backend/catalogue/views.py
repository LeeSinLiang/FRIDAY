import logging
import os

from elasticsearch import ApiError, TransportError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from catalogue import es, memory
from catalogue.feed import load_catalogue
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
