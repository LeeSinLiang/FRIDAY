from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from catalogue import memory
from catalogue.feed import load_listings
from catalogue.params import parse_search_params


def _to_payload(result) -> dict:
    payload = result.model_dump()
    if payload["facets"] is None:
        del payload["facets"]
    return payload


# Browsing the catalogue is public, like any storefront. Cart and checkout auth are decided elsewhere.
@api_view(["GET"])
@permission_classes([AllowAny])
def search(request):
    try:
        query = parse_search_params(request.query_params)
    except ValueError as exc:
        return Response({"error": "invalid_search_params", "detail": str(exc)}, status=400)
    result = memory.search(load_listings(), query.find, query.limit, query.offset)
    return Response(_to_payload(result))
