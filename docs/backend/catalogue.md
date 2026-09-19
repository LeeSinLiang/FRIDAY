# Catalogue, search and language layer

Owner: Saketh. Status: `GET /api/search` live on the in-memory backend; Elasticsearch backend live and verified against the cluster (12,040 listings indexed), with facets.

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
| `backend/catalogue/seed.py` | 12,000 deterministic synthetic listings (`source: seed`), colours from the hero palette only |
| `backend/catalogue/facets.py` | Facet definitions for both backends: memory counting and the matching Elasticsearch aggregations. Pure |
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
| `q` | Free text; every word must be a title word, the category, or part of a material |
| `category` | One of the 12 `Category` values |
| `price_min`, `price_max` | Integer **cents**, inclusive |
| `colour` | `#rrggbb`; matches listings with a nearby shade, not an exact hex |
| `material` | Case-insensitive substring of a material |
| `fits_w_mm` | Integer **mm**; keeps listings whose width is at most this |
| `limit`, `offset` | Paging. `limit` 1–100, default 24. `offset + limit` at most 10,000 (the Elasticsearch result window) |

Returns `SearchResponse`: `{ items, total, facets }`. Facets describe the whole result set, not the page:

| Facet | Meaning | Elasticsearch |
| --- | --- | --- |
| `category` | `{ key, count }[]`, count descending then key; empty categories omitted | `terms` |
| `price_band` | `{ key, count }[]` in band order, empty bands kept. Keys are cent ranges, upper bound exclusive: `0-10000`, `10000-25000`, `25000-50000`, `50000-100000`, `100000+` | `range` |
| `fits_room` | How many matching listings are at most `fits_w_mm` wide. Present only when `fits_w_mm` is given | `filter` |
| `fits_room_of` | How many listings match every other clause, ignoring `fits_w_mm`. Present only with `fits_room` | `filter` (`match_all`) |

Render the pair as "`fits_room` of `fits_room_of` fit your room" from one request. In Elasticsearch the
width clause runs as a `post_filter`, so the aggregation scope is every candidate; `category` and
`price_band` are nested under `fits_room`, so they still describe the final result set.

Band keys are identifiers; the UI owns the display text.
A malformed param returns `400 { error: "invalid_search_params", detail }`.

```bash
curl 'localhost:8000/api/search?category=armchair&fits_w_mm=900'
```

Working reference client: run `./run-local.sh`, open http://127.0.0.1:5173/dev-search.html.

## `POST /api/compile`

Public (`AllowAny`). Body `{ "text": string }`, at most 300 characters. Turns a shopper's sentence into a `Program`.

```bash
curl -X POST localhost:8000/api/compile -H 'Content-Type: application/json' \
  -d '{"text":"a reading chair by the window, under $400, 5 feet from any wall"}'
```

```json
{
  "program": { "find": [{"k":"category","value":"armchair"}, {"k":"price_max","cents":40000}],
               "place": [{"k":"near","ref":{"kind":"window","id":"w1"}},
                         {"k":"distance_min","ref":{"kind":"any_wall"},"mm":1524}] },
  "chips": ["armchair", "under $400", "near the window", "5 ft from any wall"],
  "source": "model",
  "ms": 1056
}
```

- **Show `chips`, never `program`.** Chips come from `render()` and are the only form of a Program a shopper sees. `program.find` maps one-to-one onto the `GET /api/search` params (see `toFilters` in `frontend/src/dev/search.tsx`); `program.place` goes to the solver untouched.
- **It never errors on a bad sentence or a model problem.** `source` is `model`, `model-retry` (one retry after an invalid Program), `fallback` (a plain text search of the sentence: `{find:[{k:"text",q}],place:[]}`) or `empty`. Only a malformed body returns 400.
- **Latency is about 1 s, not 400 ms.** Measured median 1,056 ms, p90 1,336 ms over 40 live calls. A one-word reply from the same API takes about 560 ms from the hackathon network, so the floor is the network and the API, not the model tier. Debounce, call on submit rather than per keystroke, and keep browsing usable without it.
- One structured-output call through the OpenAI Agents SDK with `Program` as the output type, one turn, no tools. `OPENAI_MODEL` selects the model (default `gpt-4.1-mini`: the cheapest that scores 8 of 8 on the fixture; `gpt-4.1-nano` scored 6–7 and invented placement clauses). Timeout 3 s, no transport retries.
- The model sees the Program schema and the room's ids. It never sees the search backend.
- Room ids currently come from the dev stub `backend/catalogue/mock/room.py`.

| Path | Purpose |
| --- | --- |
| `backend/catalogue/dsl/compile.py` | `compile_text()`: the call, one retry, normalising, fallback |
| `backend/catalogue/dsl/prompt.py` | Instructions for the model. Pure |
| `backend/catalogue/dsl/render.py`, `units.py`, `colours.py` | Program → chips. Pure |
| `backend/catalogue/dsl/fixtures/compile_cases.json` | 8 sentences, expected Programs and chips, recorded model outputs |
| `backend/catalogue/test_compile.py` | Offline tests. `COMPILE_LIVE_TEST=1` adds a run against the real model |

## Search backends

`SEARCH_BACKEND=memory` (default) or `elastic`, read per request from `.env`. Both return the same
`SearchResponse`. If Elasticsearch errors, is unreachable or is unconfigured, the request is served
from memory instead of failing. The `X-Search-Backend` response header says which one answered:
`memory`, `elastic` or `memory-fallback`.

| Clause | Elasticsearch |
| --- | --- |
| `text` | `must`: per token, `match` on `title`, `term` on `category`, or `wildcard` on `materials` |
| `category` | `filter`: `term` |
| `price_min`, `price_max` | `filter`: `range` on `price_cents` |
| `fits_w_max` | `filter`: `range` on `dims_mm.w` |
| `material` | `filter`: case-insensitive `wildcard` on `materials` |
| `colour` | `filter`: `terms` over the indexed hexes near the requested colour |

Both backends return the same listings in the same order (by `id`) for every structured query, and
`backend/catalogue/text.py` gives them one definition of a token. The one deliberate difference:
with a `q`, Elasticsearch orders by relevance first, so the same listings can come back in a
different order than from memory.

Colour is where the backends could drift: memory tests RGB distance per listing, Elasticsearch
filters on the indexed hexes near the requested colour. They agree exactly while the palette holds
every indexed colour. Seed listings only use the 30 hero colours, so it stays far below the cap. The palette is read from the index with a terms aggregation (up to 2,000
distinct colours) and cached per process, so restart the API after re-ingesting new colours.

Only free text scores. No embeddings, vector search or `semantic_text`, by design.

The index is created by hand with the agreed mapping. `ingest` refuses to run if the index is
missing (exit 2), because a bulk write would auto-create it with a guessed mapping. Index name
defaults to `listings`; override with `ELASTIC_INDEX`. Re-ingesting overwrites by listing id.

## Catalogue size

The catalogue is the 40 hero items plus `CATALOGUE_SEED_COUNT` seed listings (default 12,000),
generated deterministically so the memory backend and the index always hold the same data.
`uv run python -m catalogue.ingest` indexes all of it in about three seconds.

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
