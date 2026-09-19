# Saketh — tasks and agent work log

Record all agent work here when working for Saketh. Include status, file paths, verification, and blockers or handoff notes.

Lane: catalogue, search and the language layer. Branch: `codex/saketh-catalogue`. Feature doc: [docs/backend/catalogue.md](docs/backend/catalogue.md).

## In progress

- None. Waiting on go-ahead for Phase C.

## Next

- **Phase C — Elastic:** client, bulk ingest command, pure `to_es_query(find) -> body` with unit tests, `SEARCH_BACKEND` switch (memory stays default).
- **Phase D — language:** `compile(text) -> Program` via OpenAI Agents SDK with structured output, `render(program) -> list[str]`, `POST /api/compile`, fallback to a plain text clause on validation failure. Schema locks here.
- **Phase E — scale:** ~12,000 seeded listings, facets including `fits_room`.

## Done

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

- Shared files touched, additive only: `.env.example`, `INDEX.md`, `backend/pyproject.toml`, `backend/uv.lock`. Teammates need to rerun `./setup.sh` after pulling.
- Tell William: search and compile are `AllowAny` (see Phase B). His lanes are unaffected.
- `OPENAI_API_KEY` is empty in `.env`; needed before Phase D.
- The Elastic onboarding skill is installed locally only (`.agents/`, `.claude/`, `skills-lock.json` are excluded via `.git/info/exclude`, not committed).
