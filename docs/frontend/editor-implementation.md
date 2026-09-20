# Historical Three.js editor implementation and handoff

The default viewport is now the [prepared-room PlayCanvas editor](room-capture/playcanvas-implementation.md). This document describes the preserved Three.js editor at `?legacy`.

2026-09-19 · Sin · Implemented on `feat/3d-engine-frontend` with three software subagents. Now includes database-backed demo sessions and validated agent commands; see the [scene API](../backend/contracts/scene-api.md).

## Run and use

Run `./run-local.sh` from the repository root. The room starts empty. Choose **Add object** to place a clearly labeled test sofa, table, or chair. Use the object list or click a piece to select it. Drag to move, use centimeter position fields, rotate in 90° steps, remove, and undo/redo. Snap uses the configured render-unit spacing. Escape cancels an active drag or numeric draft. Geometry edits and history controls disable while dragging. Refresh restores the last saved arrangement from Django.

Perspective supports orbit, right-drag pan, and wheel zoom. Top view supports pan/zoom and hides the walls. Reset view reframes the room. Keyboard history shortcuts are Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z; Delete/Backspace removes the selected object outside text fields. Rotated footprints check room bounds and furniture overlap. Selected footprints turn green for valid positions and red for invalid drag previews; invalid releases return to the previous position. New pieces choose a nearby free grid slot.

The approved [design reference](design/selected-direction.md) informs the warm ivory, espresso, terracotta, glass panels, and reveal animation. The runtime uses simple dimensioned furniture proxies, procedural room grain, and local shadows. Actual collaborator models will supply the final furniture detail. PP Mori Regular, Semibold, Black and Italic are bundled as OTF files under `frontend/public/fonts/pp-mori/`, from the user-supplied v2.6 personal-use archive. CSS declares their actual static weights and uses font-display swap with Helvetica Neue/Arial fallbacks. The supplied license PDF is retained alongside the fonts; this archive permits personal use and excludes public websites/apps, so public deployment requires appropriate licensing. Glass uses backdrop blur and masked reveal, not optical refraction; camera view switches are immediate.

## Files and integration boundaries

| Files under `frontend/` | Responsibility |
| --- | --- |
| `src/App.tsx`, `Icons.tsx`, `style.css` | Glass UI, catalogue dialog, inspector, keyboard shortcuts, API health |
| `src/Scene.tsx` | Lazy canvas, lighting, error boundary, scene composition |
| `src/scene/types.ts`, `fixtures.ts`, `units.ts` | Minimal shared contract, empty 600 × 500 × 280 cm room, test catalogue, conversions |
| `src/scene/Room.tsx`, `RoomMaterials.ts`, `Grid.tsx`, `SceneControls.tsx` | Cutaway room, procedural materials, batched grid, responsive cameras |
| `src/scene/Furniture.tsx`, `FurnitureModel.tsx` | Test proxies, independent model clones, loading/error fallback and retry |
| `src/scene/commands.ts`, `useSceneEditor.ts`, `useFurnitureDrag.ts` | Validated edits, local undo/redo, imperative drag previews and cleanup |
| `src/scene/placement.ts`, `useSceneSync.ts` | Rotated footprint checks, free-slot search, autosave, revision conflicts and external updates |
| `src/scene/PerformanceProbe.tsx` | Opt-in development render-loop timing during drag |
| `src/CapturePanel.tsx`, `capture.css` | Saved-revision screenshot controls, preview and download |
| `src/scene/SceneCapture.tsx`, `useCaptureWorker.ts`, `captureCamera.ts`, `captureClient.ts` | Frozen snapshot renderer, leased jobs, camera fitting and capture API |
| `src/scene/SceneLighting.tsx` | Studio environment, soft daylight and warm shader background |
| `scripts/test-scene.mjs`, `src/scene/commands.test.ts` | Node tests bundled with esbuild |
| `scripts/generate-test-glb.mjs`, `public/models/test-fixture/model.glb` | Reproducible, verified 2 × 1 × 1 meter GLB |
| `scripts/dev-model-fixtures.ts` | Development-only delayed GLB response for load lifecycle checks |

Root `.env` sets `SCENE_UNIT_CM=5`. Change it and restart Vite to test another scale. Only that validated number is injected into the browser; root secrets are not exposed. App poses and dimensions remain centimeters. GLB geometry remains meters and is scaled exactly once by `100 / SCENE_UNIT_CM`. Scene geometry uses `cm / SCENE_UNIT_CM`.

To integrate a collaborator product, place its runtime files under `shared/models/furniture/<product-id>/` and add its known dimensions, name, color, placeholder kind, and `modelUrl` to root `shared/scene-fixtures.json`. The Vite plugin in `scripts/shared-furniture-assets.ts` serves these files at `/models/furniture/` and packages them into the production build. Follow the [asset contract](3d-object/collaborator-handoff.md). The current kind only selects a fallback proxy; loaded GLBs keep their own materials and geometry. The loader does not distort a GLB to force metadata dimensions. Missing assets show the proxy with a retry control. Safe geometry/material resources are shared while each instance owns a separate object hierarchy.

`SceneEdit` supports `add`, `setPose`, and `remove`; poses use `xCm`, `zCm`, and `yawRad`. `applyEdit` rejects malformed edits, duplicate instance IDs, unknown products, invalid dimensions, and non-finite poses. History retains up to 100 committed edits. Selection, camera, and snapping stay outside undo history. `useSceneSync.ts` restores and saves layouts and polls clean scenes for external agent edits. Command IDs and revision handling are implemented in the [scene API](../backend/contracts/scene-api.md); room reconstruction and the agent tool caller remain teammate integrations.

## Verification

Commands from the repository root:

```sh
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run fixture:glb
```

The tests cover 5/10 cm conversions, GLB scale, invalid configuration, edit/history behavior, malformed/no-op commands, redo invalidation, and immutable snapshots. The GLB generator roundtrips the real binary and checks exact dimensions, hierarchy independence, and safe shared resources.

Browser checks completed in the Codex in-app browser on the local macOS laptop:

- Empty room, add three test objects, selection, numeric edit, quarter-turn rotate, remove, undo/redo.
- Top/perspective/reset, snap on/off dragging, one drag/one undo, Escape cancellation with no history, numeric Escape restoration, release above canvas bounds with controls restored.
- Two copies of the real GLB have independent pose/rotation; deleting one leaves the other loaded.
- Failed URL stays isolated; supplying the missing test file then retrying recovers successfully. Temporary recovery file removed afterward.
- Five-second delayed GLB preserves a numeric edit made while loading; deleting it before completion does not recreate an object.
- A separate full-stack run at 10 cm/unit preserves 600 × 500 cm room and 200 × 100 × 100 cm GLB dimensions; default `.env` remains 5.
- Laptop layout inspected at 1366 × 768 and the browser's smaller default viewport. Object list scrolls independently; selected row follows selection.
- Short opt-in drag samples returned 62.3 FPS over 8 intervals with one proxy and 64.4 FPS over 9 intervals with three proxies, p95 16.7/16.9 ms. These are brief render-loop pacing samples, not a sustained GPU benchmark or performance guarantee with final assets.

Use `?testAssets=1` on the development URL to expose the real, delayed, and broken GLB fixtures. Use `?perf=1` for the on-screen render-loop sample after a drag. Both UI switches are development-only; the delayed route exists only in Vite development serving.

A transient React dependency-array warning occurred during hot replacement of the camera implementation; a fresh browser page had no runtime errors. The production build still reports a large lazy-loaded Three.js scene chunk (about 944 kB before gzip); no runtime dependency was added. esbuild is declared explicitly as a development dependency for the test runner.

## Placement and persistence follow-up verification

22 frontend tests and 11 Django tests pass, including rotated footprint geometry, bounded free-slot search, save serialization, pending-poll races, initial-load gating, offline retry, conflicts, CSRF, session isolation, and atomic/idempotent commands. TypeScript/Vite build and Django system checks pass; the existing large scene-chunk warning remains.

Live browser checks through the Vite proxy: valid drag changes centimeter coordinates; outside-room and overlap drops restore the prior pose; invalid numeric entry restores its value without history; duplicate add chooses a nonoverlapping grid slot; saved arrangement survives reload; clean second-tab edits propagate and clear stale undo history. Green selected footprints were visually checked. Transient red rendering is implemented and code-reviewed; automated screenshot capture did not isolate a mid-drag frame. Physical trackpad feel remains a human device check.

## Agent validation, captures and lighting

The [spatial engine tools contract](../backend/contracts/spatial-engine-tools.md) documents exact-coordinate placement, dry runs, structured rejection reasons, and trusted Python adapters. Invalid attempts preserve the layout and revision. Successful edits propagate into the editor through existing scene synchronization.

Capture supports top view and perspective with default or specified azimuth/elevation. An offscreen renderer uses a frozen saved revision without moving the user's camera. The open editor processes same-session jobs; there is no headless server renderer. PNGs report their revision and placeholder/model warnings. The Capture panel exposes the same flow for manual inspection and download.

Verification: 27 frontend tests, 22 Django tests, TypeScript/Vite build, Django system check and migration consistency passed. Live default perspective, top and custom 225°/50° requests produced visually inspected 1024 × 768 PNGs. Browser testing caught and fixed a false canvas-fallback failure, stale hot-reload job state and incorrect drawing-buffer dimensions. Trusted Python adapters were exercised for rejection without mutation, dry run, actual placement, frozen-image retrieval after a later edit and restoration of the original pose.

Room polish adds procedural plaster/limestone detail, studio reflections, a warm background shader and richer glass controls. The artificial window-pattern projection was removed after it produced an oversized X on the floor; the revised preview was visually checked with soft daylight and natural furniture shadows. The production build still warns about the large Three.js chunk. Furniture assets and the independent `codex/realistic-couch-model` worktree were left untouched.

## Remaining handoff

- Supply the actual furniture GLBs and thumbnails, then assess final rendering and sustained performance on the demo machine.
- Physical trackpad behavior, window-blur cancellation, and reduced-motion/unsupported-blur fallbacks need a human device pass; their cleanup/fallback paths are implemented.
- Mesh collision, circulation clearance, valid-space overlays, room reconstruction adapters, the actual OpenAI/voice agent caller, and commerce remain outside this change.
