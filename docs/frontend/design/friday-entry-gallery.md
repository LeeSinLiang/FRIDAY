# FRIDAY entrance and room gallery

## Scope

The root route is a minimal clickable FRIDAY entrance. `/rooms` opens the room selector directly, including returns from the editor. Existing room/query deep links, editor internals, cart, account and checkout routes retain their previous behavior.

The room index and preview deck read the existing build-provided room catalogue. All `frontend/public/room-previews` images and `shared/public-rooms.json` are unchanged. The large view is the existing room preview, including any editor controls captured in that image; it is not a generated architectural substitute. Unpackaged rooms remain disabled. A failed preview displays a fallback without changing room availability.

## Motion and controls

- The entrance has one real link, `Enter FRIDAY`, activated by click or Enter. Modified clicks retain native link behavior.
- Clicking the word pushes `/rooms` into browser history. An 820ms Web Animations transform moves the same wordmark into the header while the entrance artwork fades and the room selector appears.
- The entrance artwork has a slow scale/vertical drift. It is a flat image, not independently animated 3D objects.
- Selecting an available room brings its real preview to the front; the previous image moves sideways and returns behind the deck over 680ms. Caption and destination update immediately. Rapid selection replaces the pending shuffle cleanup.
- Arrow keys, Home and End select available rooms and skip disabled ones. The gallery heading receives focus after entering. The hidden gallery is inert until the entrance animation finishes.
- Browser Back/Forward restores entrance/gallery state. Direct `/rooms` visits bypass the entrance.
- Reduced motion disables the artwork drift and deck transitions and enters the gallery immediately.
- `Enter space` is the existing room link; it loads the editor normally. No artificial room-loading delay or simulated 3D transition is added.

## Implementation

- `frontend/src/App.tsx`: root entrance routing.
- `frontend/src/shopping/RoomSelection.tsx`: entrance, room index, stable preview deck and controls.
- `frontend/src/shopping/room-selection.css`: scoped visual system and responsive/motion rules. Shared shopping and editor CSS are unchanged.
- `frontend/public/artwork/friday-entry.jpg`: 258KB entrance-only decorative artwork, generated with the built-in imagegen tool. No new runtime dependency.

The artwork was derived from the user's approved entry concept. Final edit prompt: “Remove ONLY the central text FRIDAY and orange period, filling that space seamlessly with the existing warm ivory background. Preserve exactly the surrounding sculptural architecture, glass, stone, aluminum, terracotta forms, wireframe outlines, framing, positions, shadows, lighting, palette, image proportions and all remaining pixels as closely as possible. No text of any kind should remain. The central area must remain empty and quiet so a real HTML wordmark can be overlaid and animated there.” It was converted to JPEG for delivery; the wordmark is real HTML.

## Verification

Base: freshly fetched main `5afe3929723fa2e129b96d47a208e35001728244`, separate worktree and feature branch `codex/friday-entry-gallery`. No parent worktree files or running servers changed.

- Fresh-main backend: `OPENAI_API_KEY= ELASTIC_API_KEY= ELASTIC_URL= DEEPGRAM_API_KEY= SEARCH_BACKEND=memory TRANSCRIBE_BACKEND=browser COMPILE_LIVE_TEST=0 uv run python manage.py test` → `Ran 390 tests in 14.829s` / `OK (skipped=5)`.
- Initial implementation: `npm test` → 195 + 25 passed, zero failures; `VERCEL=1 npm run build` → `built in 3.84s`.
- Canonical local stack: `BACKEND_PORT=8297 FRONTEND_PORT=5297 DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,friday-entry.localhost ./run-local.sh`.
- Browser: click/Enter entrance; wordmark and gallery reveal; studio → London shuffle (observed live transform and `friday-shuffle` animation); arrow-key destination updates; disabled Cg Arch; existing London GLB/editor loading and Rooms return; mobile at 390x844 with no horizontal overflow; reduced-motion styles `animation: none` and `transition: 0s`; Back/Forward.
- Screenshots under `.scratch/entry-gallery/`: `entrance-desktop.png`, `entrance-transition.png`, `gallery-london.png`, `shuffle-transition.png`, `entrance-mobile.png`, and `entered-skyscraper.png`.

Final build identity, final screenshots and server cleanup are recorded in TODO_WILLIAM.md. The user authorized merging after local acceptance and confirmed main is not frozen. Current main voice and lighting changes are integrated without source conflicts. Remote PR/merge and post-merge results are tracked in TODO_WILLIAM.md; production deployment is a separate operation.
