"""Bulk-index the merchant feed into Elasticsearch.

Run from backend/:  uv run python -m catalogue.ingest [path/to/feed.json]
Exit codes: 0 indexed, 1 some documents failed, 2 cannot proceed (config, cluster or index missing).
"""

import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

from dotenv import load_dotenv
from elasticsearch import ApiError, TransportError, helpers

from catalogue.es import get_client, index_name
from catalogue.feed import FEED_PATH, load_listings
from catalogue.types import Listing, to_wire

REPO_ROOT = Path(__file__).resolve().parent.parent.parent


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
    indexed, errors = helpers.bulk(client, to_actions(listings, index), raise_on_error=False, refresh="wait_for")
    print(f"indexed {indexed} into '{index}', {len(errors)} failed")
    for error in errors[:5]:
        print(f"  failed: {error}", file=sys.stderr)
    return 1 if errors else 0


def main(argv: list[str]) -> int:
    load_dotenv(REPO_ROOT / ".env")
    feed_path = Path(argv[1]) if len(argv) > 1 else FEED_PATH
    try:
        return ingest(load_listings(feed_path))
    except KeyError as exc:
        print(f"missing setting {exc}; set it in .env", file=sys.stderr)
    except ApiError as exc:
        print(f"cluster rejected the request: HTTP {exc.status_code}", file=sys.stderr)
    except TransportError as exc:
        print(f"cluster unreachable: {type(exc).__name__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
