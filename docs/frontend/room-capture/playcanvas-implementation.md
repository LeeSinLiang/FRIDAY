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

Explore by dragging to look around. **Walk** enables WASD on reviewed floor; Escape exits. Choosing furniture opens a cursor-following floor preview; click to confirm, Escape to cancel. Select and drag an added object, edit its centimeter coordinates, rotate by 90°, remove, or undo/redo. Navigation stops while editing and when focus leaves the canvas.

Placement shows green for valid test geometry, red for fixed/new furniture collisions and amber for unverified floor. Invalid releases preserve the saved layout. Every successful edit is accepted by Django before entering history. Retry preserves the exact uncertain request, and external changes during a preview produce a conflict instead of silently replacing it.

**Floor plan** is an explicitly schematic view. Reviewed floor, unknown space, fixed obstacles and new furniture remain separate. The scanned walls/roof are not presented as an overhead photograph. **Capture** requests either an interior perspective PNG with the current or adjusted camera, or a labeled `spatial_plan` PNG. Both use the frozen server layout and geometry revision.

The active catalogue now contains the collaborator’s [textured grey sofa GLB](../3d-object/sofa-glb-integration.md). Primitive and scale-reference products are retired from normal selection but retained for saved-layout compatibility and diagnostics. Additional furniture models and catalogue-search integration remain separate work.

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
