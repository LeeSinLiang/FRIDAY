# Prepared-room PlayCanvas implementation

2026-09-19 · Sin · `codex/gaussian-splatting`

The default editor loads the [Cg Arch mesh interior](cg-arch-interior.md); its appearance is still under correction. This document describes the Studio 11 Gaussian fixture, available at `?room=studio-11`, with fixed scanned furniture and separately editable GLB furniture. Both retain the approved Atelier glass panels and Mori. The previous Three.js editor remains at `?legacy`; `?testAssets=1` opens its diagnostic fixture.

## Run locally

1. Run `./setup.sh` if dependencies have not been installed.
2. Download Studio 11 from its creator, retaining the ZIP and license. The user supplied `Studio 11.zip` for this build.
3. From the repository root, run `python3 scripts/prepare_studio_room.py '/path/to/Studio 11.zip'`. This runs the pinned local SplatTransform tool; a supported local WebGPU adapter is required. No capture data is uploaded.
4. Run `backend/.venv/bin/python backend/manage.py migrate` to apply `0004_prepared_rooms`, then run `./run-local.sh` and open the printed frontend URL.

Large generated files live in ignored `shared/rooms/studio-11/assets/`. Vite streams `/rooms/` in development and includes prepared runtime assets in production builds. Raw `source.ply` is excluded. Builds deliberately fail when a manifest references missing assets. Keep the licensed archive available to reproduce the assets on another laptop.

## What the room contains

[Studio 11](https://superspl.at/scene/c37cb759), by Goce Milanoski, is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Attribution appears in the editor; the original license is retained in `shared/rooms/studio-11/license.txt`.

The package has three separate responsibilities:

- `manifest.json` supplies the room identity, immutable geometry revision, scan transform, default interior camera, attribution and calibration status.
- `assets/room.sog` supplies photographed appearance. It does not supply semantic furniture or placement guarantees.
- `spatial.json` supplies a small reviewed demo floor-region union and fixed obstacle rectangles. The generated uncarved 5 cm voxel shell and triangle GLB can be displayed with **Surface reference**, but they are not automatically trusted as free space or precise collision geometry.

Calibration is explicitly `synthetic_demo`: source units are assumed to be meters, with an approximate floor/obstacle annotation. The fixture is suitable for integration tests and demonstration, not real furniture-fit assurance. Areas outside the reviewed floor union are unknown and reject placement. A 5 cm grid does not establish 5 cm measurement accuracy.

Raw PLY appearance uses a 180° Z rotation plus the manifest translation. SplatTransform's emitted surface mesh is already in PlayCanvas orientation, so it receives the same translation/scale without that extra rotation. This difference was checked visually against the supplied scene.

## Editor behavior

The perspective room starts in Walk, ready for a room click to capture the pointer. Press **F** or click **Walk** to enter pointer-locked walking: WASD moves on reviewed floor at 240 cm/s, Shift increases speed to 360 cm/s, Space jumps, and mouse movement turns the camera without dragging. Gravity brings the camera back to the floor or lands it on the dimensioned top of placed furniture; walking off a top makes it fall. Jumping is bounded by the room ceiling and does not cross reviewed floor limits or fixed room obstacles. Furniture collision and support use each placed product's rotated rectangular dimensions, not the exact cushion mesh; fixed scanned obstacles have no recorded height and remain full-height navigation blockers. F again or Escape exits and restores the cursor; clicking placed furniture exits and opens its inspector. F also enters Walk from a selected object. Browsers do not count Escape as a fresh pointer-lock activation, so Escape only exits Walk. A room click or WASD key retries capture if a browser denies the first request; drag-look remains available. Choosing furniture opens a cursor-following floor preview; click to confirm, Escape to cancel. In perspective, finishing or cancelling placement, deselecting or removing an object restores Walk; returning from Floor plan does the same. Pointer capture is requested when browser activation permits. Select and drag an added object, edit its centimeter coordinates, rotate by 90°, remove, or undo/redo. Navigation stops while editing and when focus leaves the canvas.

Placement shows green for valid test geometry, red for fixed/new furniture collisions and amber for unverified floor. Invalid releases preserve the saved layout. Every successful edit is accepted by Django before entering history. Retry preserves the exact uncertain request, and external changes during a preview produce a conflict instead of silently replacing it.

The bottom-left floor card keeps a compact person direction arrow fixed and moves a simple, lightly gridded room outline around that position as the camera turns and walks. Its expand button enlarges the map; the compass needle rotates with world north relative to the current view. The outer compass size is unchanged. This is an orientation aid; **Floor plan** shows the detailed reviewed floor and furniture geometry. The card shows Floor 1 / 1 for this fixture, so the vertical up/down floor controls are disabled; ceiling height does not imply additional floors. The furniture panel starts as a slim rounded category rail with a circular chevron. The chevron opens the full catalogue or collapses it back to the rail without clearing its category, favorites or scroll position. Choosing a category from the compact rail opens that category. Selecting furniture opens its inspector. The separate Add furniture button and the editor's Capture control have been removed; the separate agent screenshot service still uses the frozen server layout and geometry revision.

The narrow right furniture catalogue uses a category rail, sofa-type filters, scrollable cards, local favorites, and a details action. Clicking a sofa card immediately starts the floor placement preview. The collaborator’s [textured grey sofa GLB](../3d-object/sofa-glb-integration.md) has its real room model; the six sofa concepts use explicitly provisional dimensions in `shared/scene-fixtures.json`, illustrative prices, vector card previews, and the editor’s stand-in sofa shape. Their placement can be saved as a fixture preview but does not represent a verified merchant product. Other category cards still show **Import coming soon** in details and cannot be placed. Favorites remain local to the mounted panel during collapse and expand. Primitive and scale-reference products are retired from normal selection but retained for saved-layout compatibility and diagnostics. Additional real product imports and vendor price verification remain separate work.

In the shopping app, `/rooms`, `/cart`, account and checkout routes still use their existing flow. The room header retains Rooms and Cart links. The new furniture panel offers **Search purchasable catalogue**, which opens the live catalogue and its explicit placement confirmation; closing it clears any armed listing. The provisional concept cards remain room previews and cannot be checked out. The room editor no longer presents the old Capture button, while the background capture worker remains mounted for supported capture requests.

## Integration map

| Files | Role |
| --- | --- |
| `frontend/src/SplatEditor.tsx`, `splat-editor.css` | Atelier shell, catalogue/inspector, modes, capture and status controls |
| `frontend/src/PlayCanvasScene.tsx` | Effect-owned runtime and interaction lifecycle |
| `frontend/src/scene/playcanvas/` | One PlayCanvas app/device, splat and GLB assets, navigation, placement, overlays, lighting and captures |
| `frontend/src/scene/useRoomSession.ts` | Authoritative commands/history, polling, retry and conflict handling |
| `backend/api/room_context.py`, `scene_service.py` | Prepared-room loading and exact-pose validation against the same fixed geometry |
| `backend/api/capture_service.py`, `engine_tools.py` | Room-scoped frozen screenshot jobs and trusted Python agent adapters |
| `scripts/prepare_studio_room.py`, `frontend/scripts/shared-room-assets.ts` | Reproducible local preparation and asset serving/build packaging |

All scene endpoints accept `?roomId=studio-11`; omission preserves `demo-room`. See the [scene API](../../backend/contracts/scene-api.md) and [spatial engine tools](../../backend/contracts/spatial-engine-tools.md) for exact requests, failure codes and capture representations.

## Verification and remaining limits

The accepted visual is adaptively merged to 2 million splats, packed as a roughly 23 MiB SOG; the runtime caps DPR at 1. On the local Apple Silicon laptop (macOS 26.6, Codex in-app browser, WebGL2, PlayCanvas 2.22.2), a 60-second moving-camera run with one 2 m GLB and one 1024 × 768 capture rendered 3,395 frames: 56.58 FPS, median 16.9 ms, p95 24.2 ms and p99 41.6 ms at 1280 × 547. The original 5-million-splat run at DPR 1.5 was about 21.7 FPS and was rejected as the default. Different hardware, larger windows or multiple active GPU tabs may be slower.

The adaptive visual retained coherent sofa/wall edges and correctly occluded a GLB behind the scanned sofa in inspected views. Its perspective PNG was about 1.16 MB, within the 1.5 MiB upload cap. These are measured fixture results, not arbitrary-scene guarantees. Local evidence is under ignored `.room-preparation/`; final checks are recorded in `TODO_SIN.md`. Automated coverage includes room/session isolation, fixed-obstacle and unknown-area rejection, atomic command batches, authoritative history/retry, capture validation and runtime cleanup. A real room/GLB render and actual PNG capture are required in addition to unit tests.

Automatic phone-video reconstruction, sensor calibration, semantic surface extraction, precise mesh collision, production furniture, relighting/contact-shadow matching and arbitrary-room uploads are not implemented by this prepared-room slice. The [migration plan](first-person-playcanvas-plan.md) remains the roadmap for those subsequent gates.

## Empty mesh fixture

Use `?room=empty-room` for the [simple empty mesh room](empty-mesh-room.md), or `?room=studio-11` for this captured-room implementation. Layouts remain isolated by room ID. The current default is the Cg Arch interior linked above.
