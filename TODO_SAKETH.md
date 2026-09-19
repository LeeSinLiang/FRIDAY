# Saketh — tasks and agent work log

Record all agent work here when working for Saketh. Include status, file paths, verification, and blockers or handoff notes.

Lane: catalogue, search and the language layer. Branch: `codex/saketh-catalogue`. Feature doc: [docs/backend/catalogue.md](docs/backend/catalogue.md).

## In progress

- None. All lane phases A–E are done; Phase F (voice) only if asked.

## Next


## Done

- **compile(): wall exceptions (2026-09-19).** Branch `codex/saketh-wall-exceptions`, off fresh `main` (97 tests green before branching). No schema change.
  - Bug: "3 feet from all walls except left wall, 2 feet there" compiled to `distance_min(any_wall, 914)` AND `distance_min(w-w, 610)`; `any_wall` covers `w-w`, so the exception was silently erased.
  - Prompt (`backend/catalogue/dsl/prompt.py`): `any_wall` only for uniform rules; one clause per wall when there is an exception or differing values; left/right mapped to west/east; separate rule for one-wall kinds. Strengthened `fits_w_max` after the longer prompt made the bookcase case drop it.
  - Code (`backend/catalogue/dsl/compile.py`): `repair_walls()` in `normalise()` makes it deterministic — expands `any_wall` beside a looser per-wall clause, collapses identical per-wall clauses to `any_wall`, turns several walls on `near`/`against`/`on` into `any_wall`; place clauses ordered by room wall order.
  - Found while checking `clear` and `near`: `clear` had the same bug and the same fix works. `near`/`against` are different: enumerating walls ANDs them into an impossible placement, and an exception there cannot be expressed in the DSL, so it is dropped.
  - Ninth fixture case added; all nine re-recorded. Verification: `manage.py test api catalogue` — 103 tests OK, 1 skipped, API key blanked. Live: 11 wall phrasings × 8 rounds all correct after the final change; nine-case live fixture passed 4 of 4.

- **Phase D follow-up: fallback, timeout, retry, review fixes (2026-09-19).** Same branch and PR (#11); `main` merged in after #9 landed, one conflict in this file resolved by keeping both entries.
  - Latency DoD revised by Saketh to p50 under 1,500 ms (compile is a submit action). Measured after these changes: p50 1,182 ms, p90 1,667 ms, max 2,392 ms over 24 live calls, 24 of 24 exact. `gpt-4.1-mini` stays.
  - Fallback fixed: `backend/catalogue/text.py` gains `STOP_WORDS`, `content_words()` and `keep_matching()`; `fallback_program()` searches content words and keeps a word only if results remain (`text_search_has_results` in `views.py`, against the memory catalogue so it works with the model and Elasticsearch both down). The hero sentence now degrades to "reading chair" (235 results) instead of the whole sentence (0 results). Costs 0–45 ms; title tokens are cached in `title_words()`.
  - Timeout 3 s → 6 s; the single retry now also covers timeouts; auth and quota errors are not retried; an abandoned call is cancelled.
  - Review fixes: `POST /api/compile` throttled to 30/min per client (`CompileThrottle`), search untouched; `GET /api/search` accepts repeated `material` / `colour` params so "oak and steel" keeps both clauses, and the dev page sends them.
  - Verification: `manage.py test api catalogue` — 97 tests OK, 1 skipped, API key blanked; `npm run build` passes; live fixture test passed 3 of 3 runs; forced-failure run (nonexistent model) returned useful results for every sentence tried.

- **Phase D — language (2026-09-19).** Branch `codex/saketh-compile`, off `main` (not stacked).
  - Built: `backend/catalogue/dsl/compile.py` (`compile_text`: one structured-output call through the OpenAI Agents SDK with `Program` as output type, one turn, no tools; at most one retry on an invalid Program; never raises; falls back to `{find:[{k:"text",q}],place:[]}`), `prompt.py`, `render.py` + `units.py` + `colours.py` (Program → chips, pure), `POST /api/compile` in `views.py` / `urls.py` (`AllowAny`, 300-character cap), fixture `dsl/fixtures/compile_cases.json` (8 sentences, expected Programs, chips, recorded model outputs), tests in `test_compile.py`, dev page text box wired to the endpoint. Wall labels added to the mock room for chips.
  - Model: `OPENAI_MODEL`, default `gpt-4.1-mini`. Started at the bottom: `gpt-4.1-nano` scored 4/8, then 6–7/8 after prompt work, and kept inventing placement clauses or expanding `any_wall` into four walls; `gpt-4o-mini` 6–7/8 (drops materials); `gpt-5.4-nano` 6/8; `gpt-4.1-mini` 8/8 on every run. Latency is the same across tiers.
  - Shared file touched: `.env.example` gains an optional `OPENAI_MODEL` line.
  - Verification: `manage.py test api catalogue` — 79 tests OK, 1 skipped (the live test), run with `OPENAI_API_KEY` blanked to prove no network. `npm run build` passes. Live through `POST /api/compile`: 40 compiles, 40 of 40 exact-match Programs, median 1,056 ms, p90 1,336 ms, min 709, max 2,620. Dev page driven in headless Chrome end to end.
  - **Latency DoD not met: median 1,056 ms against a 400 ms budget.** A one-word reply from the same API takes about 560 ms from this network (time to first token 360–490 ms on every model tried, including priority tier), so no model choice reaches 400 ms here.
  - About 1 call in 20–50 hangs past the 3 s timeout and degrades to a text search. Every live failure observed was a timeout; none was a wrong Program. Timeouts are not retried, as specified.

- **`facets.fits_room_of` (2026-09-19).** Branch `codex/saketh-fits-room-of`. PR #8 (Phase E) merged to `main` first, including a review fix: ingest now removes stale seed documents when the seed count shrinks.
  - Contract change, approved by Saketh, additive and optional, in its own commit touching only `backend/catalogue/types.py` and `frontend/src/lib/types.ts`: `fits_room_of` is the count matching every clause except the width gap. Absent without `fits_w_mm`.
  - Implementation: `facets.py`, `memory.py`, `to_es_query.py` (width clause moves to `post_filter`; `fits_room_of` is a `match_all` filter aggregation; category and price facets nest under `fits_room`). Dev page shows "N of M fit".
  - Verification: `manage.py test api catalogue` — 64 tests OK; `npm run build` passes. Live: `category=armchair&fits_w_mm=900` gives 523 of 1,005 in one request from Elasticsearch; 270-query sweep across both backends, 268 identical, 2 free-text queries with identical totals and facets in relevance order.

- **Phase E — scale and aggregations (2026-09-19), done before Phase D because D is blocked on the OpenAI key.** Branch `codex/saketh-scale`.
  - PRs #2, #3, #5 merged to `main` in order (merge commits). Deleting #2's branch closed #3 instead of retargeting it; recovered by restoring the branch, reopening, retargeting to `main`, then deleting again. For #5 the retarget was done before the delete. `main` after all three: 45 tests OK, `npm run build` passes.
  - Built: `backend/catalogue/seed.py` (12,000 deterministic seed listings, 30-colour hero palette only), `facets.py` (memory counting + matching Elasticsearch aggregations: `terms` category, `range` price bands, `filter` fits_room), `load_catalogue()` in `feed.py`, aggregations in `to_es_query.py` / `es.py`, facets on the memory backend, ingest of the full catalogue with a single refresh, facets on the dev page. Tests in `test_scale.py`.
  - Fixed: `offset + limit` beyond 10,000 made Elasticsearch reject the request and silently fall back to memory. Both backends now return 400 past that window.
  - Verification: `manage.py test api catalogue` — 57 tests OK; `npm run build` passes. Live: ingest indexed 12,040, 0 failed, in 2.8 s; count 12,040 (12,000 seed + 40 ikea); mapping still exactly the agreed one, no dynamic fields; 30 distinct colours. `/api/search?fits_w_mm=` 600 / 900 / 1200 gives `fits_room` 3,383 / 5,142 / 6,924 with `X-Search-Backend: elastic`; absent without the param. Fresh API processes after ingest. 266-query sweep across both live backends comparing items and facets: 265 identical, no fallbacks; `q=lamp steel` has the same total (388) and facets but a different first page, the documented relevance-order difference. Latency on localhost: memory 5–15 ms, Elasticsearch 40–50 ms from this laptop.

- **Phase C — Elastic (2026-09-19).** Branch `codex/saketh-elastic`, stacked on Phase B. PR #5.
  - Built: `backend/catalogue/to_es_query.py` (pure), `es.py` (client + backend), `ingest.py` (bulk, refuses a missing index), `text.py` (shared tokenizer), backend switch with memory fallback and `X-Search-Backend` header in `views.py`, tests in `test_elastic.py`.
  - Backend alignment: memory now orders by id (the Elasticsearch tiebreak) and matches text by whole title word, exact category or material substring, the same three ways as the Elasticsearch query. Colour threshold tightened from 90 to 60 after a test showed dark green matching near-black.
  - Verification: `manage.py test api catalogue` — 45 tests OK, no network, all 7 find clauses covered; colour agreement proven offline over 246 probe colours. Live on Elasticsearch 9.5.4: ingest indexed 40, 0 failed, count 40, no dynamic fields added to the mapping. `curl '/api/search?category=armchair&fits_w_mm=900'` under `memory` and `elastic` is byte-identical (2,648 bytes), headers `memory` and `elastic`, no fallback logged. Sweep of 261 queries across both live backends: 260 identical, 0 with different results, 1 order-only (`q=lamp steel`, relevance order — deliberate, documented).

- **Phase B — search stubs (2026-09-19).** Branch `codex/saketh-search-stubs`, stacked on the Phase A branch.
  - `GET /api/search` on the in-memory backend: `backend/catalogue/{views,urls,params,memory,colour,feed,thumbs}.py`, feed in `backend/catalogue/data/listings.json` (40 items, all 12 categories), tests in `backend/catalogue/test_search.py`.
  - `backend/catalogue/mock/room.py` — dev stub room (walls `w-n/w-e/w-s/w-w`, door `d1`, window `w1`, instances `sofa-1`, `lamp-1`) and `room_refs()` for compile().
  - Dev page `frontend/dev-search.html` + `frontend/src/dev/search.tsx` — standalone Vite entry, so `App.tsx` is untouched and it is not in the production build.
  - Shared file touched: one `include("catalogue.urls")` line in `backend/api/urls.py` (agreed with Saketh).
  - **Auth decision:** search is `AllowAny`, and compile will be too. Reason: catalogue browsing must work logged-out like any storefront, and the UI lane is blocked without it. Scoped to these two views only; the project default stays `IsAuthenticated`. Cart and checkout auth are William's call — tell him when he is next around.
  - Env: catalogue keys now live in the repo's single `.env`; `.env.local` removed. Key name is `OPENAI_API_KEY` (empty until Phase D).
  - Verification: `manage.py check` clean; `manage.py test api catalogue` — 21 tests OK; `npm run build` passes; `curl '/api/search?category=armchair&fits_w_mm=900'` returns 4 armchairs with integer mm dims; dev page rendered in headless Chrome: 24 rows on load, 4 after applying the same filters, all thumbnails decoded.

- **Phase A — scaffold and shared types (2026-09-19).**
  - Adapted the lane to the existing Django + Vite stack instead of Next.js: API in Django, validating schemas in Pydantic, TypeScript mirrors for the frontend.
  - Added `backend/catalogue/types.py`, `backend/catalogue/dsl/schema.py`, `backend/catalogue/tests.py`, `frontend/src/lib/types.ts`, `frontend/src/lib/dsl/schema.ts`, `docs/backend/catalogue.md`.
  - Dependencies added to `backend/pyproject.toml` / `uv.lock`: `elasticsearch`, `pydantic`, `openai-agents`. No frontend dependencies added.
  - Appended catalogue keys (empty values) to the shared `.env.example`; added the doc to `INDEX.md`.
  - Verification: `manage.py check` clean; `manage.py test api catalogue` — 8 tests OK; `npm run build` passes; `./run-local.sh` serves the frontend (200) and `/api/health/` directly and through the Vite proxy.

- **PR #2 review fixes (2026-09-19).**
  - Contract wire format: added `to_wire()` in `backend/catalogue/types.py` (`exclude_none`), so `facets`, `fits_room`, optional `Ref` ids, `near.mm` and `qty` are omitted instead of serialized as `null`, matching the TypeScript types. `Listing.model_url` stays present-and-nullable via a serializer. TypeScript unchanged. Tests: `WireFormatTests` in `backend/catalogue/tests.py`.
  - Removed the stale `.env.local` guidance from `.env.example`; only `.env` is loaded.
  - Verification: `manage.py test api catalogue` — 12 tests OK on the Phase A branch.

## Blockers / handoff

- **Cross-lane, not built (no assets yet):** units stay millimetres in the catalogue and centimetres in the 3D pipeline, converted as `mm / 10` at Sin's boundary. Wanted later: a check that a listing's GLB bounding box agrees with `dims_mm / 10`, failing loudly instead of rendering at the wrong scale. Needs Sin's loader and real `model_url` assets.

- Phase E note: seeded listings must draw colours from a bounded palette (under 2,000 distinct), or the colour filter's palette aggregation truncates and the backends drift.

- Shared files touched, additive only: `.env.example`, `INDEX.md`, `backend/pyproject.toml`, `backend/uv.lock`. Teammates need to rerun `./setup.sh` after pulling.
- Tell William: search and compile are `AllowAny` (see Phase B). His lanes are unaffected.
- `OPENAI_API_KEY` is empty in `.env`; needed before Phase D.
- The Elastic onboarding skill is installed locally only (`.agents/`, `.claude/`, `skills-lock.json` are excluded via `.git/info/exclude`, not committed).
