# Catalogue, search and language layer

Owner: Saketh. Status: `GET /api/search` live on the in-memory backend; Elasticsearch backend live and verified against the cluster (12,041 listings indexed), with facets.

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
| `backend/catalogue/data/listings.json` | Stub merchant feed: 43 items, real dimensions; a few carry a `model_url` (each checked against its GLB by `api/test_furniture_assets.py`), feed-shaped (`source`, `fetched_at`) |
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
| `colour` | `#rrggbb`; matches listings with a nearby shade, not an exact hex. May repeat |
| `material` | Case-insensitive substring of a material. May repeat: `material=oak&material=steel` means both |
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
- **It never errors on a bad sentence or a model problem.** `source` is `model`, `model-retry`, `fallback` or `empty`. There is at most one retry, shared between an invalid Program and a timeout; errors that would repeat (auth, quota) are not retried. A malformed body returns 400; more than 30 requests a minute from one client returns 429 (search is not throttled).
- **The fallback still finds things.** It searches the sentence's content words: stop-words, numbers, and placement, price and size vocabulary are dropped, then each remaining word is kept only if results remain with it. "a reading chair by the window, under $400, 5 feet from any wall" degrades to `{find:[{k:"text",q:"reading chair"}],place:[]}` and returns reading chairs; the whole sentence would return nothing. If no word is searchable, `find` is empty and the shopper browses everything.
- **Compile is a submit action, not a keystroke one.** Target p50 under 1,500 ms; measured p50 1,056–1,182 ms, p90 1,336–1,667 ms. A one-word reply from the same API takes about 560 ms from the hackathon network, so the floor is the network and the API, not the model tier. Call it on submit and keep browsing usable without it.
- One structured-output call through the OpenAI Agents SDK with `Program` as the output type, one turn, no tools. `OPENAI_MODEL` selects the model (default `gpt-4.1-mini`: the cheapest that scores 8 of 8 on the fixture; `gpt-4.1-nano` scored 6–7 and invented placement clauses). Timeout 6 s (normal calls take 0.7–2.6 s), no transport retries.
- The model sees the Program schema and the room's ids. It never sees the search backend.
- **`any_wall` means two different things, and the solver must honour both.** For `distance_min` and `clear` it means *every* wall; for `near`, `against` and `on` it means *any one* wall. Clauses are ANDed and the DSL has no OR, so:
  - A uniform rule is one `any_wall` clause. A rule with an exception ("3 ft from all walls except the left, 2 ft there") is one clause per wall and no `any_wall`, which would otherwise override the exception.
  - "Near any wall except the east one" cannot be expressed; it compiles to `near(any_wall)` and the exception is dropped.
  - `normalise()` enforces this after the model: `any_wall` beside a looser per-wall clause is expanded per wall, identical clauses on every wall collapse to `any_wall`, and several walls on a one-wall kind become `any_wall`. Per-wall clauses come out in the room's wall order.
  - Plans are read north-up: left is west, right is east.
- Room ids currently come from the dev stub `backend/catalogue/mock/room.py`.

| Path | Purpose |
| --- | --- |
| `backend/catalogue/dsl/compile.py` | `compile_text()`: the call, one retry, normalising, fallback |
| `backend/catalogue/dsl/prompt.py` | Instructions for the model. Pure |
| `backend/catalogue/dsl/render.py`, `units.py`, `colours.py` | Program → chips. Pure |
| `backend/catalogue/dsl/fixtures/compile_cases.json` | 9 sentences, expected Programs and chips, recorded model outputs |
| `backend/catalogue/test_compile.py` | Offline tests. `COMPILE_LIVE_TEST=1` adds a run against the real model |

## Voice: `GET` and `POST /api/transcribe`

Voice is an input method, not a feature: whatever is heard lands in the same box, and goes to the same `/api/compile`, as typing.

- `GET /api/transcribe` → `{ "backend": "deepgram" | "browser" }`. The page asks once and uses that.
- `POST /api/transcribe` with the recording as the raw body and an `audio/*` content type → `{ text, backend, ms }`. The server forwards it to **Deepgram's pre-recorded API** (`nova-3`). **The browser never talks to Deepgram and never sees the key.** Silence is `text: ""`, not an error.
- `TRANSCRIBE_BACKEND=deepgram|browser`, default `browser`. `deepgram` without `DEEPGRAM_API_KEY` quietly becomes `browser`, so a missing secret degrades the feature instead of breaking it. With `browser` the page uses the Web Speech API: no key, no server, works offline in Chrome.
- **A Deepgram failure costs one press, never the session.** While recording for Deepgram the page also runs the browser's recogniser as a shadow. If the server answers 503 it uses the shadow's transcript *for that press*, and the next press tries Deepgram again. Nothing latches onto the fallback. With `?dev=1` the panel shows the configured backend and **which backend actually answered the last transcript**, including after a fallback, so a silent fallback cannot be mistaken for success.
- **`search`, `compile_program` and `transcribe_audio` are deliberately anonymous** (`authentication_classes = []`). They are public and stateless. With DRF's default session authentication a signed-in shopper's POSTs were refused for a missing CSRF token before the view ran. It also makes the throttles apply to everyone: `AnonRateThrottle` skips authenticated users, so a signed-in session used to bypass the cap on the two endpoints that cost money. **Throttling is per client address, for signed-in and anonymous callers alike.** Only these three views; scene, account and checkout endpoints keep their authentication. CORS is unchanged (same-origin only).
- If Deepgram fails or times out (10 s): `503 { error: "transcription_unavailable", fallback: "browser" }`. Logs carry the HTTP status or error type only, never the key or the provider's response body.
- Refused before any provider call: not audio → 415; over 2 MB → 413. Public, throttled to 20 requests a minute per client, and the throttle fails open like compile's.
- Frontend: `frontend/src/catalogue/transcribe.ts` (`fetchBackend`, `canListen`, `listen`); the panel's microphone button is press to talk, press to stop, and it releases the microphone at once.
- Tests are offline with a recorded Deepgram response. `TRANSCRIBE_LIVE_TEST=1` sends `backend/catalogue/voice_fixtures/reading-chair.wav` to the real API.

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

### The index must agree with the files: re-ingest after every listings change

Search reads the index; placement and the server's stored copy of a product read `load_catalogue()`,
that is, the files. When they drift nothing errors. A listing that gained a `model_url` in
`listings.json` still comes back from search without it, so its hover and its unconfirmed box have
no model, and in the browser-authoritative `?legacy` editor it stays a grey box for good. (A stale
index never *refuses* a placement: the server compares dimensions only and stores its own copy.)

```bash
cd backend
uv run python -m catalogue.ingest        # after ANY change to listings.json, seed.py or the seed count
uv run python -m catalogue.index_check   # exit 0 AGREE, 1 DISAGREE, 2 cannot proceed
```

`index_check` compares a **count and a SHA-256 over every document's canonical JSON**, reading the
whole index by `search_after` on `id`. Count alone is not enough: a changed `model_url` leaves the
count the same. On disagreement it names the listings and fields, for example
`ikea-403.608.74: model_url is None in the index, '/models/…/model.glb' in the files`.
`ELASTIC_LIVE_TEST=1 uv run python manage.py test catalogue.test_index_check` runs the same
comparison as a test; it is skipped by default because the suite must pass offline. It is not
possible to store the hash in the index instead, since that would mean changing the mapping.

**There is one shared index, so ingest from `main`, after the merge.** Ingesting from a feature
branch makes the index match that branch and disagree with everyone running `main`. While a
listings change sits in an open PR the check on that branch will say DISAGREE, and that is correct.

## Search counts everything and returns what can be placed

`GET /api/search` **aggregates over the whole catalogue, and by default returns everything with the listings that have a `model_url` first.** (Only-mode, described next, returns just those.) The facets, `fits_room` and `fits_room_of` are computed over every match, so "524 of 1,006 armchairs fit your room" is a statement about 12,000 listings and does not shrink. Only `items` and `total` are narrowed: `total` is the number of listings that can be returned and paged through, always equal to what paging over `items` yields.

- In Elasticsearch the narrowing is `post_filter`, which runs after aggregation: `{"exists": {"field": "model_url"}}`, combined with the width gap when there is one. `model_url` is mapped `keyword` with `index: false`, but doc values are on, so `exists` works on it. The memory backend filters after faceting, and the two agree.
- **One line in `.env`, three settings:** `SEARCH_RESULTS_REQUIRE_MODEL=boost` returns **everything, with the listings that have a model first**, the way a shop puts what is in stock at the top; it is **the default**, also when the variable is empty or unset, and it is how the demo runs. `=1` returns only listings with a model. `=0` is plain order. Every response says which applied in `X-Search-Results: model-first | with-model | all`. In the default mode the panel reads "1,006 matches · 1 ready in 3D, shown first"; in only-mode, "1,006 matches in the catalogue · 1 ready in 3D".
- Boosting is a `should` clause (`constant_score` on `exists(model_url)`, boost 1000, far above any text score) so text relevance still orders each group. **An empty search needs a `match_all` beside it:** a boolean query with nothing required matches only documents that satisfy an optional clause, whatever `minimum_should_match` says. That was found on the live index (an empty boosted search returned 7 of 12,045) after a unit test had pinned the wrong belief.
- Every match is still countable from the response without a new field: the category facet sums to it. The catalogue panel uses that to read "392 matches in the catalogue · 1 ready in 3D".
- The pure functions (`memory.search`, `es.search`, `to_es_query`) take `models_only` and default to `False`; the flag is read once, in `catalogue/views.py`.

On 2026-09-20 five listings have models (mirror, chair, armchair, table, bed), so the hero sentence (an armchair under $400) returns **one** hit. The list reads as a store once there are about ten armchairs with models under $400; that is the asset lane's target, and nothing here needs to change when they land, apart from a re-ingest.

## A price of 0 means unknown, not free

`Listing.price_cents` is a required integer, so a listing whose price nobody knows carries **0** (the Amazon Berkeley Objects listings: real products, real models, no price). Zero is not a price (`catalogue/pricing.py`):

- It **never satisfies a price filter**, in either direction. `price_max` is `1 <= price <= max`; `price_min` is `price >= max(min, 1)`. "Armchairs under $400" is a claim about a price we would have to know.
- It is **in no price band**. The memory backend skips it when counting bands, and the Elasticsearch range aggregation's first band starts at 1 cent with its key still `0-10000`. It is still counted by category, so with unpriced matches the bands sum to less than the category facet, which is correct.
- It is **never shown as `$0`**: the catalogue panel and the dev page print "price unavailable" (`frontend/src/catalogue/price.ts`).
- With no price clause it is found like anything else.

Before this rule a probe with one sofa at `price_cents: 0` was returned by `price_max=40000`, moved the `0-10000` band from 0 to 1, and its card read `$0`; `catalogue/test_unknown_price.py` replays exactly that. After ingesting unpriced listings, `ELASTIC_LIVE_TEST=1 uv run python manage.py test catalogue.test_unknown_price` checks that memory and the live index still agree on six price queries.

## Catalogue size

The catalogue is the hero items in `listings.json` (43 on 2026-09-20) plus `CATALOGUE_SEED_COUNT` seed listings (default 12,000),
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
