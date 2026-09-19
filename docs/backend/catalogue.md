# Catalogue, search and language layer

Owner: Saketh. Status: `GET /api/search` live on the in-memory backend. Elasticsearch and `compile()` land next.

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
| `backend/catalogue/views.py`, `urls.py` | `GET /api/search`, included from `backend/api/urls.py` |
| `backend/catalogue/mock/room.py` | DEV STUB room and `room_refs()`; deleted when the real `Room` ships |
| `frontend/dev-search.html`, `frontend/src/dev/search.tsx` | DEV SCAFFOLD page, dev server only, not in the production build |
| `backend/catalogue/tests.py`, `test_search.py` | Contract, search, endpoint and mock-room tests, no network |

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
