"""Does the Elasticsearch index hold exactly the catalogue the files describe?

Search reads the index; placement reads load_catalogue(). When they drift, a hovered listing comes
back without the model_url its file has, and nothing errors. A count alone misses that case (a
changed model_url leaves the count the same), so this compares a content hash as well.

Run from backend/:  uv run python -m catalogue.index_check
Exit codes: 0 they agree, 1 they disagree (re-ingest: uv run python -m catalogue.ingest),
2 cannot proceed (config, cluster or index missing).
"""

import hashlib
import json
import sys
from collections.abc import Iterable, Iterator
from pathlib import Path

from dotenv import load_dotenv
from elasticsearch import ApiError, TransportError

from catalogue.es import get_client, index_name
from catalogue.feed import load_catalogue
from catalogue.types import to_wire

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
PAGE_SIZE = 1000
PAGE_TIMEOUT_S = 30
MAX_REPORTED = 8


def canonical(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def fingerprint(docs: Iterable[dict]) -> tuple[int, str]:
    """Count and a SHA-256 over the documents' canonical JSON in id order, so input order is irrelevant."""
    digest, count = hashlib.sha256(), 0
    for doc in sorted(docs, key=lambda d: d["id"]):
        digest.update(canonical(doc).encode("utf-8"))
        digest.update(b"\n")
        count += 1
    return count, digest.hexdigest()


def file_docs() -> list[dict]:
    """The catalogue exactly as ingest would send it."""
    return [to_wire(listing) for listing in load_catalogue()]


def index_docs(client, index: str) -> Iterator[dict]:
    """Every document's _source, paged by search_after on the keyword id (no scroll, no PIT needed)."""
    paged, after = client.options(request_timeout=PAGE_TIMEOUT_S), None
    while True:
        extra = {"search_after": after} if after else {}
        hits = paged.search(index=index, size=PAGE_SIZE, query={"match_all": {}}, sort=[{"id": "asc"}],
                            track_total_hits=False, **extra)["hits"]["hits"]
        if not hits:
            return
        for hit in hits:
            yield hit["_source"]
        after = hits[-1]["sort"]


def differences(in_file: Iterable[dict], in_index: Iterable[dict]) -> list[str]:
    """Human-readable disagreements, worst first: missing from the index, extra in it, then changed fields."""
    wanted = {doc["id"]: doc for doc in in_file}
    found = {doc["id"]: doc for doc in in_index}
    lines = [f"not in the index: {doc_id}" for doc_id in sorted(wanted.keys() - found.keys())]
    lines += [f"in the index but not in the files: {doc_id}" for doc_id in sorted(found.keys() - wanted.keys())]
    for doc_id in sorted(wanted.keys() & found.keys()):
        if canonical(wanted[doc_id]) == canonical(found[doc_id]):
            continue
        keys = sorted(k for k in wanted[doc_id].keys() | found[doc_id].keys() if wanted[doc_id].get(k) != found[doc_id].get(k))
        lines += [f"{doc_id}: {key} is {found[doc_id].get(key)!r} in the index, {wanted[doc_id].get(key)!r} in the files" for key in keys]
    return lines


def check() -> int:
    client, index = get_client(), index_name()
    if not client.indices.exists(index=index):
        print(f"index '{index}' does not exist", file=sys.stderr)
        return 2
    in_file, in_index = file_docs(), list(index_docs(client, index))
    (file_count, file_hash), (index_count, index_hash) = fingerprint(in_file), fingerprint(in_index)
    print(f"files: {file_count} listings, sha256 {file_hash[:16]}")
    print(f"index: {index_count} listings, sha256 {index_hash[:16]}  ('{index}')")
    if (file_count, file_hash) == (index_count, index_hash):
        print("AGREE")
        return 0
    found = differences(in_file, in_index)
    print(f"DISAGREE in {len(found)} place(s); re-ingest with: uv run python -m catalogue.ingest", file=sys.stderr)
    for line in found[:MAX_REPORTED]:
        print(f"  {line}", file=sys.stderr)
    if len(found) > MAX_REPORTED:
        print(f"  ... and {len(found) - MAX_REPORTED} more", file=sys.stderr)
    return 1


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    try:
        return check()
    except KeyError as exc:
        print(f"missing setting {exc}; set it in .env", file=sys.stderr)
    except ApiError as exc:
        print(f"cluster rejected the request: HTTP {exc.status_code}", file=sys.stderr)
    except TransportError as exc:
        print(f"cluster unreachable: {type(exc).__name__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
