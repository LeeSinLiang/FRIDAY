# AI recommends sidebar

Owner: William. Branch: `codex/ai-recommends-sidebar`, based on available main `9adbf97`.

## Interaction

AI recommends is the first category and opens by default in the existing right furniture panel.
The existing panel toggle collapses it to the category rail, which includes a microphone button.
Command+Shift+D (Control+Shift+D on other keyboards) opens AI recommends and starts dictation;
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

The manifest covers all 86 deployed catalogue GLBs: seven existing thumbnails and 79 newly
rendered PNGs. `scripts/render_catalogue_thumbnails.py` reproducibly renders missing images from
those exact GLBs using Blender, preserving existing images and model bytes. Run from the root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/render_catalogue_thumbnails.py
```

New previews are approximately 6.3 MB total. Cards lazy-load static images, never the GLBs.
Existing model-folder attribution/license metadata also applies to these derived previews.

## Verification, 2026-09-20

- Canonical setup and isolated `BACKEND_PORT=8268 FRONTEND_PORT=5268 ./run-local.sh`.
- `OPENAI_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test`: `Ran 281 tests in 17.959s`, `OK (skipped=5)`.
- `npm test`: `tests 184 / pass 184 / fail 0`, plus `tests 25 / pass 25 / fail 0`.
- `npm run build`: `built in 6.05s`.
- Live catalogue response: `X-Search-Backend: elastic`, `X-Search-Results: model-first`, 1,017 armchair matches.
- Live Deepgram endpoint: repository WAV transcribed as `A reading chair under $400.` in 572 ms.
- Browser: AI-first rail, matching cards, category/query preservation, collapse/expand, microphone shortcut
  from collapsed rail and focused input, start/stop/cancel, no-results state, fit preview and placement confirmation.
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
