# Catalogue, search and language layer

Owner: Saketh. Status: `GET /api/search` live on the in-memory backend; Elasticsearch backend built and unit-tested, live verification pending the `listings` index. `compile()` lands next.

## What this is

Natural language compiles into a small constraint `Program`. `find[]` filters the catalogue
(Elasticsearch, with an in-memory fallback); `place[]` is handed to the floor solver as data.
This layer never does geometry.

## Where things live

| Path | Purpose |
| --- | --- |
| `backend/catalogue/types.py` | `Listing`, `SearchResponse` — validating definition (Pydantic) |
| `backend/catalogue/dsl/schema.py` | `Program`, 7 `FindClause` + 6 `PlaceClause`, `Ref` — validating definition |
| `frontend/src/lib/types.ts` | TypeScript mirror of `types.py` |
| `frontend/src/lib/dsl/schema.ts` | TypeScript mirror of `dsl/schema.py` |
| `backend/catalogue/data/listings.json` | Stub merchant feed: 40 items, real dimensions, feed-shaped (`source`, `fetched_at`) |
| `backend/catalogue/feed.py` | Reads the feed into validated `Listing`s; fills in generated thumbnails |
| `backend/catalogue/thumbs.py` | SVG data-URI placeholder thumbnails (no image assets) |
| `backend/catalogue/params.py` | Query params → find clauses. Pure |
| `backend/catalogue/memory.py` | In-memory search backend. Pure. Default and demo fallback |
| `backend/catalogue/colour.py` | "About this colour" matching by RGB distance |
| `backend/catalogue/to_es_query.py` | Find clauses → Elasticsearch body. Pure; the model never sees this |
| `backend/catalogue/es.py` | Elasticsearch client and search backend. The only search code that does cluster I/O |
| `backend/catalogue/ingest.py` | Bulk-indexes the feed: `uv run python -m catalogue.ingest` from `backend/` |
| `backend/catalogue/views.py`, `urls.py` | `GET /api/search`, included from `backend/api/urls.py` |
| `backend/catalogue/mock/room.py` | DEV STUB room and `room_refs()`; deleted when the real `Room` ships |
| `frontend/dev-search.html`, `frontend/src/dev/search.tsx` | DEV SCAFFOLD page, dev server only, not in the production build |
| `backend/catalogue/tests.py`, `test_search.py`, `test_elastic.py` | Contract, search, endpoint, query-building and backend-switch tests, no network |

The Python and TypeScript files are a pair: change both in the same commit.

## `GET /api/search`

Public (`AllowAny`). Trailing slash optional. All params optional and ANDed together.

| Param | Meaning |
| --- | --- |
| `q` | Free text; every token must appear in title, category or materials |
| `category` | One of the 12 `Category` values |
| `price_min`, `price_max` | Integer **cents**, inclusive |
| `colour` | `#rrggbb`; matches listings with a nearby shade, not an exact hex |
| `material` | Case-insensitive substring of a material |
| `fits_w_mm` | Integer **mm**; keeps listings whose width is at most this |
| `limit`, `offset` | Paging. `limit` 1–100, default 24 |

Returns `SearchResponse`: `{ items: Listing[], total }`. `facets` is absent until aggregations ship.
A malformed param returns `400 { error: "invalid_search_params", detail }`.

```bash
curl 'localhost:8000/api/search?category=armchair&fits_w_mm=900'
```

Working reference client: run `./run-local.sh`, open http://127.0.0.1:5173/dev-search.html.

## Search backends

`SEARCH_BACKEND=memory` (default) or `elastic`, read per request from `.env`. Both return the same
`SearchResponse`. If Elasticsearch errors, is unreachable or is unconfigured, the request is served
from memory instead of failing. The `X-Search-Backend` response header says which one answered:
`memory`, `elastic` or `memory-fallback`.

| Clause | Elasticsearch |
| --- | --- |
| `text` | `must`: per token, `match` on `title` or `term` on `category` / `materials` |
| `category` | `filter`: `term` |
| `price_min`, `price_max` | `filter`: `range` on `price_cents` |
| `fits_w_max` | `filter`: `range` on `dims_mm.w` |
| `material` | `filter`: case-insensitive `wildcard` on `materials` |
| `colour` | `filter`: `terms` over the indexed hexes near the requested colour |

Only free text scores. No embeddings, vector search or `semantic_text`, by design.

The index is created by hand with the agreed mapping. `ingest` refuses to run if the index is
missing (exit 2), because a bulk write would auto-create it with a guessed mapping. Index name
defaults to `listings`; override with `ELASTIC_INDEX`. Re-ingesting overwrites by listing id.

## Rules

- **Units:** integer millimetres and integer cents everywhere. Convert only in the UI.
- **`dims_mm` is required** on every listing.
- **Optional means absent, never `null`.** Serialize contract models with `to_wire()` from `catalogue/types.py`, not `model_dump()`. The one nullable field is `Listing.model_url`, which is always present.
- **The DSL is closed at 13 clauses.** An unmappable phrase is dropped, never invented as a new clause.
- Solver invariants (inside the floor, no overlap, supported, door swing) are never clauses.
- Raw clause syntax is never shown to a user outside a dev page.

## Configuration

Keys are listed in `.env.example`: `ELASTIC_URL`, `ELASTIC_API_KEY`, `SEARCH_BACKEND`
(`memory` default, or `elastic`), `OPENAI_API_KEY`. The memory backend stays the default so the
demo works with Elasticsearch or the model unavailable.

## Checks

```bash
(cd backend && uv run python manage.py test catalogue)
(cd frontend && npm run build)
```
