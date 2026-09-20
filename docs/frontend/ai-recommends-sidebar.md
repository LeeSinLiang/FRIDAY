# AI recommends sidebar

Owner: William. Initially developed on `codex/ai-recommends-sidebar` from main `9adbf97`;
integrated with the current scene designer on `codex/ai-sidebar-main-integration`.

## Interaction

AI is the first category and opens by default in the existing right furniture panel.
The existing panel toggle collapses it to the category rail. Speak is in the bottom editor toolbar,
outside the open search form and category rail.
Command+Shift+D (Control+Shift+D on other keyboards) opens AI and starts dictation;
press it again to stop and search the transcript. Plain D still belongs to walking/typing.
Switching categories or closing the panel releases microphone capture and discards late transcripts.
Typed requests, chips, result counts, fit highlights, rotation, placement confirmation and cart
mutations use the existing catalogue/scene integration. The query survives category changes.

`FurnitureCatalogue` supplies a stable DOM slot. `SplatCatalogueLayer` portals the existing
`CatalogueShelf` into it. The layer retains ownership of placement, floor masks, confirmation and
scene submission. The standalone legacy shelf remains available. The floor map no longer needs
the old search overlay's compact mode.

## Search and images

The request path stays `compileSentence` → `/api/compile` → `searchCatalogue` → `/api/search`.
The backend still chooses Elasticsearch or its configured memory fallback. No new recommendation
ranker, catalogue schema, index ingestion or agent tool was added. Existing relevance, constraints,
model-first ordering, dimensions, IDs and unknown-price behavior are preserved.

`ListingImage` prefers the catalogue's real image URL. Generated initial tiles and broken image
URLs fall back to the exact model's packaged thumbnail via `shared/catalogue-thumbnails.json`.
Missing images are labeled unavailable. No unrelated product image is substituted.

The integration manifest covers all 98 current catalogue GLBs, including the new workstation
pieces: existing thumbnails plus 79 newly rendered PNGs. `scripts/render_catalogue_thumbnails.py` reproducibly renders missing images from
those exact GLBs using Blender, preserving existing images and model bytes. Run from the root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_catalogue_thumbnails.py
```

New previews are approximately 6.3 MB total. Cards lazy-load static images, never the GLBs.
Existing model-folder attribution/license metadata also applies to these derived previews.

## Current-main integration and large-floor interaction

The embedded shelf passes room ID and revision to the current designer job path, and uses the
current scene confirmation and cart path. The visible card copy is display-only: cards and the
placement preview format known Elastic integer-cent values as US dollars, while preserving the
original listing for placement and cart.
Unknown prices remain unavailable. The current London lobby's hundreds of reviewed rectangles
are indexed by horizontal bands for exact quarter-turn coverage checks; non-axis-aligned placement
keeps polygon clipping. Large 5 cm fit grids run in a worker so picking a card does not freeze
the editor while the fit mask is computed. The existing floor arrows remain the only floor control.

Local browser acceptance on the current 34-floor London room used `./run-local.sh` on 5281/8281.
Tables showed 20 model-backed cards out of 27 matches, with names, providers and PNG previews.
Selecting a table opened its placement preview in 284 ms; fit calculation then enabled a valid
suggestion. Confirmation saved one instance and Cart (1) remained after browser reload. The
backend scene row also retained that instance. Floor 1 → Floor 2 → Floor 1 and the bottom Speak
recording/cancel state were verified in the same browser. The full integration checks passed:
backend 393 tests (5 skipped), frontend 209 scene/catalogue plus 25 account tests, board 6 tests,
and Vite build in 3.15 seconds.

### Main release, 2026-09-20

PR [#110](https://github.com/LeeSinLiang/hackmit2026/pull/110) passed backend,
frontend and security CI and merged as `fba5ab1cf8733595bf03387e71862612353eba98`.
The clean merged checkout passed `./setup.sh`, 393 backend tests (5 skipped), 209
scene/catalogue tests, 25 account tests, 6 board tests and a Vite build. Its runtime
source identity is `7dae28167a5e096ef28e622169c3619948a88db5d6e1ee1cc5e8be318179b040`.

Production API deployment `dpl_3QQDj9vkp4HU6AY67hFfusPDPSW2` and frontend
deployment `dpl_HqRst43QJ4GhY7351owEDvgqjxHs` are Ready at the stable
`friday-hackmit-api.vercel.app` and `friday-hackmit.vercel.app` aliases. Direct
and rewritten `/api/health/` returned HTTP 200 with the same `X-Friday-Build`
identity, and the public browser's `data-build` matched. The API's Production
Elastic settings were configured server-side; public model-only search returned
`X-Search-Backend: elastic` and `X-Search-Results: with-model`.

The public browser opened the actual London entrance and showed AI-first
recommendations, the Tables tab with 20 of 27 model-backed cards and exact-model
images, bottom Speak, and Floor 1 → 2 → 1. The local browser additionally
confirmed table placement/cart persistence and the known-price chair preview.
Public screenshot: `.scratch/sidebar-main/public-london-tables.png` in the
release worktree. The existing Vercel Git binding issue [#74](https://github.com/LeeSinLiang/hackmit2026/issues/74)
still requires manual deployment on future merges.

## Category browsing

Ordinary tabs use the same catalogue shelf and placement layer instead of the previous literal
concept cards. Each tab requests `/api/search?category=...&limit=20&models=only`. Chairs combines
chair + armchair, Tables combines table + desk, and Storage combines storage + shelf; these are
separate queries because repeated category clauses are ANDed. Results merge in stable ID order
and are capped at the first 20. The hardcoded thumbnail manifest is preferred for these cards;
the browser loads static PNGs and loads the GLB only for placement. The list scrolls within the
existing panel. No model means an explicit empty state, not a fabricated preview.

Category switches cancel stale requests and clear held items/placement constraints. The AI
sentence, chips and results survive switching back, and its spatial constraints are restored.
The request-only filter leaves default AI and standalone search behavior unchanged, including
memory fallback. No Elastic credential is sent to the browser. Runtime must configure
`SEARCH_BACKEND=elastic` and the existing server-side Elastic credentials to use the live index.

## Verification, 2026-09-20

- Canonical setup and isolated `BACKEND_PORT=8268 FRONTEND_PORT=5268 ./run-local.sh`.
- `OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test`: `Ran 281 tests in 17.959s`, `OK (skipped=5)`.
- `npm test`: `tests 184 / pass 184 / fail 0`, plus `tests 25 / pass 25 / fail 0`.
- `npm run build`: `built in 6.05s`.
- Live catalogue response: `X-Search-Backend: elastic`, `X-Search-Results: model-first`, 1,017 armchair matches.
- Live Deepgram endpoint: repository WAV transcribed as `A reading chair under $400.` in 572 ms.
- Browser check before the bottom-toolbar correction: AI-first rail, matching cards, category/query preservation,
  collapse/expand, microphone shortcut from the earlier rail location and focused input, start/stop/cancel,
  no-results state, fit preview and placement confirmation.
  Deterministic voice fixture reported two starts and two stream stops; it was removed by reloading.
  Physical microphone recording was not required for this test.
- Browser placement confirmation reached Cart (1), but reloading the in-app browser returned Cart (0)
  and a fresh scene, on both 127.0.0.1 and localhost. This remains an unresolved browser-session
  verification issue. A separate HTTP session confirmed one cart item and one scene instance and
  retained both on fresh GET requests. No cart, authentication, backend or persistence code changed.
- Runtime listener working directories matched this branch's frontend/backend. Source, built and served
  sample PNG SHA-256 all matched `90ae797809c33bd026cd5dd45c7e0317ba200b20e5bb789a62ee9a7d3de9959b`.
- Cleanup: temporary browser tab closed; canonical stack stopped; ports 8268/5268 verified without listeners. Board tests: `6 passed / 0 failed`.
- Screenshots: `.scratch/ai-recommends-expanded.png`, `.scratch/ai-recommends-collapsed.png`.

Delivery is local to this branch. It has not been pushed, merged or deployed to Vercel. Keep the task
active until browser-session persistence is resolved or independently verified through the user's
normal browser. Parent-thread scene-agent work remains separate.

## Category follow-up verification

- Local runtime: canonical `BACKEND_PORT=8279 FRONTEND_PORT=5279 ./run-local.sh`, with the existing Elastic credentials supplied to the process only. `X-Search-Backend: elastic`, `X-Search-Results: with-model`.
- Live counts: Lighting 11, Chairs 20, Tables 27 (first 20 shown), Storage 13; Rugs and Plants 0 models.
- Browser: Lighting 11/11 PNGs loaded; Tables 20/20 loaded through scrolling; Chairs 20 cards; Plants empty state. AI `a lamp` query survives category changes. Lamp selection enters the existing fit preview; coordinate adjustment and cancel work. This follow-up does not claim a new persistence or confirmed-placement test.
- `OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test`: `Ran 284 tests in 14.438s`, `OK (skipped=5)`.
- `npm test`: `tests 187 / pass 187 / fail 0`, plus `tests 25 / pass 25 / fail 0`.
- `npm run build`: `built in 5.03s`. Existing optional room-asset and bundle-size warnings remain.
- Board checks: `tests 6 / pass 6 / fail 0`. `git diff --check` passed.
- Runtime cwd matched this worktree; the source, built and served lamp PNG share SHA-256 `ccce6f37df269621834651b7bad396354a91df8748dec735eac99e5b5431327a`.
- Screenshots: `.scratch/category-lighting.png`, `.scratch/category-tables-scroll.png`, `.scratch/category-lamp-preview.png`.
- Cleanup: temporary test tab closed; stack stopped; no listeners on 8279/5279. Other task runtimes were preserved.
- [Issue #101](https://github.com/LeeSinLiang/hackmit2026/issues/101) remains open for delivery. No push, merge, or Vercel update; the existing sidebar task's browser guest-session persistence limitation remains separate.

## Bottom Speak control correction

The category and open heading read `AI`. Speak appears once in the bottom editor toolbar, including while
the panel is collapsed. The embedded search form and category rail have no microphone button. At narrow
widths, the open panel ends above the bottom Speak control so touch users can finish dictation. The
Command+Shift+D shortcut remains active; the standalone legacy catalogue keeps its own microphone.

- Running preview: `http://127.0.0.1:5279/room/empty-room`, served from this worktree. Browser checks at
  1280 × 720 and 390 × 844 showed `AI`, one bottom Speak button, and no mic in the open form or rail.
  The collapsed rail retained the category controls. The desktop toolbar clears the panel by 9 px.
- `npm test`: `tests 187 / pass 187 / fail 0`, then `tests 25 / pass 25 / fail 0`.
- `OPENAI_API_KEY= ELASTIC_API_KEY= SEARCH_BACKEND=memory TRANSCRIBE_BACKEND=browser COMPILE_LIVE_TEST=0 .venv/bin/python manage.py test`:
  `Ran 284 tests in 13.972s`, `OK (skipped=5)`.
- `npm run build`: `built in 4.23s`. Optional local room assets and bundle-size warnings remain.
- `git diff --check` passed. The existing local preview remains available for user testing.

## Bottom voice recording state

Selecting Speak opens a dark recording strip in the existing bottom toolbar. Its elapsed-time waveform
fills from left to right, then scrolls as recording continues. Only the newest segment animates while
the browser or Deepgram microphone session is listening; it stays still while transcribing.
The square cancels and discards the capture; the arrow finishes recording and submits a successful
transcript through the same compile/search path as typed input. The browser's reduced-motion setting
disables the segment animation. On a narrow screen the strip sits below the panel; the embedded search form and
category rail keep their single AI entry and no microphone control. The existing keyboard shortcut
uses the same start/finish flow.

Cancelling a Deepgram capture stops microphone tracks without posting the audio blob. Closing the shelf
or switching categories cancels the active capture as well. The standalone legacy shelf keeps its own
voice button and backend selection.

The running worktree preview at `http://127.0.0.1:5279/room/empty-room` was checked in the in-app
browser at 1280 × 720 and 390 × 844. Both screenshots show the active waveform, cancel square and
finish arrow clear of the AI panel (`.scratch/voice-recording-desktop.jpg` and
`.scratch/voice-recording-mobile.jpg`). Cancel restored the single Speak button without a query;
finishing a silent recording restored Speak and showed the existing retry message. The waveform's
computed animation was active during listening. A controlled Deepgram adapter check observed zero
uploads on cancel and one on finish, with both microphone tracks released.

The isolated staged snapshot, excluding the concurrent product-card draft, passed `npm test` with
`187 passed, 0 failed` plus `25 passed, 0 failed`, and `npm run build` with `built in 2.54s`.
The full backend suite reported `Ran 284 tests in 13.653s / OK (skipped=5)` in the live worktree;
no backend files changed in this follow-up. `git diff --cached --check` passed. The preview remains
local to this worktree; the existing sidebar task stays active for delivery/persistence work.

## Progressive timeline correction

The 40-segment recording timeline starts at `0:00`, fills with elapsed time, and scrolls after its
visible history is full. The timer runs inside `VoiceCapture`, so the editor and 3D scene do not
rerender on every 180 ms update. The old instruction bubble is visually hidden during recording;
its live status remains readable to assistive technology. Cancel restores the single Speak button,
and a new recording starts its timeline at zero.

The running 5279 preview was checked at 1280 × 720 and 390 × 844. Desktop progress advanced from
2 to 34 filled segments, and the mobile strip stayed at x=16–374 below the panel bottom y=766.
Screenshots: `.scratch/progressive-voice-desktop.jpg` and `.scratch/progressive-voice-mobile.jpg`.
`npm test` reported `187 passed / 0 failed` plus `25 passed / 0 failed`; full backend
`manage.py test` reported `Ran 284 tests in 11.123s / OK (skipped=5)`; `npm run build` reported
`built in 3.83s`. No catalogue, placement, cart, or floor code changed for this correction.
At 390 × 844, a browser check confirmed the live status remains in the accessibility tree
(`display: block`, clipped to 1 px) with no visible bubble; the final CSS build reported
`built in 3.86s`.

## Concise product cards

`shared/catalogue-card-copy.json` supplies a short name for all 86 existing model-backed listings.
`ListingCardCopy` shows only that name, the listing's provider, and the price. IKEA is shown as IKEA;
Amazon Berkeley Objects use the brand in the original title when present. The fixed copy does not
overwrite listing metadata or change the Elastic index. Dimensions, long merchant titles, model
references and IDs remain in the original Listing passed to placement, search and confirmation.

`cardPrice` formats known integer-cent values with US currency grouping and two decimal places
(e.g. `$149.00 USD`, `$449.99 USD`, `$1,249.00 USD`). Missing/zero catalogue prices display
`Price unavailable`, never a fabricated amount. Cards for new or uncurated search results use a
short title fallback. Card-specific styles keep the existing sidebar/voice controls intact.

Earlier local preview verification found 11 Lighting cards and 20 each for Tables and Chairs, with
no overflow at the 340px list width. HERRÅKRA selection/placement preview/cancel still worked.
The final name/provider/price layout supersedes the earlier detail-bullet layout; see the current
verification record in `TODO_WILLIAM.md`. Existing preview remains running.
