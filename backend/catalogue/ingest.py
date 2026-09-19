"""Bulk-index the catalogue (hero feed plus seed listings) into Elasticsearch.

Run from backend/:  uv run python -m catalogue.ingest
Restart the API afterwards: the colour palette is cached per process.
Exit codes: 0 indexed, 1 some documents failed, 2 cannot proceed (config, cluster or index missing).
"""

import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

from dotenv import load_dotenv
from elasticsearch import ApiError, TransportError, helpers

from catalogue.es import get_client, index_name
from catalogue.feed import load_catalogue
from catalogue.types import Listing, to_wire

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
BULK_TIMEOUT_S = 60
CHUNK_SIZE = 1000


def to_actions(listings: Iterable[Listing], index: str) -> Iterator[dict]:
    """One bulk action per listing. The listing id is the document id, so re-ingesting overwrites."""
    for listing in listings:
        yield {"_op_type": "index", "_index": index, "_id": listing.id, "_source": to_wire(listing)}


def ingest(listings: Iterable[Listing]) -> int:
    client, index = get_client(), index_name()
    # A bulk write to a missing index would auto-create it with a guessed mapping. Never allow that.
    if not client.indices.exists(index=index):
        print(f"index '{index}' does not exist; create it with the documented mapping first", file=sys.stderr)
        return 2
    bulk_client = client.options(request_timeout=BULK_TIMEOUT_S)
    indexed, errors = helpers.bulk(bulk_client, to_actions(listings, index), chunk_size=CHUNK_SIZE,
                                   raise_on_error=False)
    client.indices.refresh(index=index)
    print(f"indexed {indexed} into '{index}', {len(errors)} failed")
    for error in errors[:5]:
        print(f"  failed: {error}", file=sys.stderr)
    return 1 if errors else 0


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    try:
        return ingest(load_catalogue())
    except KeyError as exc:
        print(f"missing setting {exc}; set it in .env", file=sys.stderr)
    except ApiError as exc:
        print(f"cluster rejected the request: HTTP {exc.status_code}", file=sys.stderr)
    except TransportError as exc:
        print(f"cluster unreachable: {type(exc).__name__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
