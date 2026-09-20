"""Elasticsearch search backend. All cluster I/O for search lives here; query building does not."""

import os
from collections.abc import Sequence
from functools import lru_cache

from elasticsearch import Elasticsearch

from catalogue.facets import facets_from_aggs
from catalogue.to_es_query import to_es_query
from catalogue.types import Listing, SearchResponse

REQUEST_TIMEOUT_S = 3
MAX_PALETTE = 2000


def index_name() -> str:
    return os.getenv("ELASTIC_INDEX", "listings")


@lru_cache(maxsize=1)
def get_client() -> Elasticsearch:
    """Build the shared client.

    Raises:
        KeyError: ELASTIC_URL or ELASTIC_API_KEY is not set.
    """
    return Elasticsearch(
        os.environ["ELASTIC_URL"],
        api_key=os.environ["ELASTIC_API_KEY"],
        request_timeout=REQUEST_TIMEOUT_S,
    )


@lru_cache(maxsize=1)
def _palette() -> tuple[str, ...]:
    # Cached for the process lifetime: the colour set only changes on re-ingest.
    response = get_client().search(
        index=index_name(), size=0,
        aggs={"colours": {"terms": {"field": "colour_hex", "size": MAX_PALETTE}}},
    )
    return tuple(bucket["key"] for bucket in response["aggregations"]["colours"]["buckets"])


def search(find: Sequence, limit: int, offset: int, models_only: bool = False) -> SearchResponse:
    """Run find clauses against the index.

    Raises:
        KeyError: connection settings missing.
        elasticsearch.ApiError: the cluster rejected the request.
        elasticsearch.TransportError: the cluster could not be reached.
    """
    needs_palette = any(clause.k == "colour" for clause in find)
    body = to_es_query(find, _palette() if needs_palette else (), limit, offset, models_only)
    # `from` is a Python keyword, so the client spells that one parameter `from_`.
    params = {("from_" if key == "from" else key): value for key, value in body.items()}
    response = get_client().search(index=index_name(), **params)
    hits = response["hits"]
    return SearchResponse(
        items=[Listing.model_validate(hit["_source"]) for hit in hits["hits"]],
        total=hits["total"]["value"],
        facets=facets_from_aggs(response["aggregations"]),
    )
