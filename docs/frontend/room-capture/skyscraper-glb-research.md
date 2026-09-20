# Multistory GLB designer research

Research only, 2026-09-20. Reviewed `origin/main` at `13297be8c637f0669660a434282f20af1b3d2b97` in the isolated `codex/skyscraper-glb` worktree. No application code, source model, runtime, or deployment was changed.

## Recommendation

Keep one original textured building GLB, detect and review its floor surfaces offline, and expose each accepted floor or split-level zone as a distinct room context. Reuse FRIDAY's current planar placement solver, room-scoped persistence, catalogue, cart and captures. Add building-level orchestration around those contexts. A GLB is already a mesh container supported by the renderer; the missing capability is multistory spatial interpretation and designer context.

Do not divide the building height by a presumed story count. Store floor elevation, ceiling clearance and slab thickness separately. They describe different things and can vary independently.

## What main currently does

| Stage | Current implementation | Consequence for this model |
| --- | --- | --- |
| Prepared input | `shared/rooms/<id>/manifest.json` + `spatial.json`; `backend/api/room_context.py::prepared_room` validates reviewed fixtures | No general model upload or automatic mesh-to-floor extraction exists. |
| Visual loading | `frontend/src/scene/playcanvas/room.ts::loadSplatRoom` branches on `visualFormat: glb`; `assets.ts` loads a PlayCanvas container and calls `instantiateRenderEntity` | The existing GLB path can render building geometry and materials. No splat conversion is required. |
| Coordinates | `scene/units.ts`: GLB metres → centimetres → engine units; manifest position, rotation and scale are authoritative | Preserve node transforms, including nested transforms, before analysing geometry. No silent fit-to-room scaling. |
| Placement | `scene/types.ts::Pose` is `{xCm,zCm,yawRad}`; `playcanvas/furniture.ts::applyFurniturePose` puts furniture at Y=0; picking defaults to the Y=0 plane | A whole tower cannot be treated as one current room. Each floor needs a local frame. |
| Spatial rules | `RoomSpatial.freeAreas` is a union of rectangles plus fixed obstacles; `region/floor.ts` builds boundaries from those rectangles; `scene_service.py` validates full furniture footprints | Visual triangles do not automatically become collision or furnishing geometry. |
| Height and walking | Backend checks product height against one `room.heightCm`; `playcanvas/navigation.ts` walks in X/Z at fixed camera height | One clearance value cannot describe a split-level lobby or varying ceilings safely. Stair movement is absent. |
| Persistence | `SceneLayout` is unique by session and room ID; `scene_for_session` accepts prepared rooms through `room_context` | A stable floor-specific room ID can isolate saved layouts and existing cart entries. The older `layout_key` helper's preset restriction is not the current storage path. |
| Selection and packaging | `SplatEditor.tsx` has five allowed prepared IDs; `/room/:id` is gated by public gallery entries; `shared-room-assets.ts` serves only manifest-listed files within each room's directory | Adding a GLB to disk alone will not make it selectable. Shared building assets need an explicit package/registry extension. |
| AI input | `catalogue/views.py::compile_program` supplies `room_refs(MOCK_ROOM)` to the text-to-DSL compiler. `dsl/compile.py` sends text plus instructions through the Agents SDK | The current language model does not receive the mesh, actual selected room geometry, or screenshots automatically. |
| Agent tools | `backend/api/engine_tools.py` provides `try_place`, `request_scene_capture`, `read_scene_capture`, all room-scoped | Useful adapters exist, but they are not wired into the current one-turn compiler as an autonomous building designer. |
| Captures | `playcanvas/capture.ts` renders revision-bound perspective captures; top captures explicitly return a 2D `spatial_plan` | Reuse perspective screenshots and floor plans. A rendered cutaway of one story is a separate feature. |

GLB scene hierarchies, materials and textures are part of the [glTF specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html). PlayCanvas's [container API](https://api.playcanvas.com/engine/classes/ContainerResource.html) exposes an entity hierarchy for those renderable meshes. The installed engine here is pinned to 2.22.2; online API documentation inspected reports 2.22.1, so actual runtime behavior must be tested against the installed version.

## Findings from the supplied GLB

Source: `/Users/williamxu/Downloads/free-london-skyscraper/edited/London_Skyscraper_Unfurnished.glb`.

- SHA-256: `0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9`.
- 38,784,232 bytes; glTF 2.0; 58 mesh nodes and primitives; 141,583 triangles; 18 materials; 45 embedded images. No external image files are required by this GLB.
- World geometry bounds: X −17.641…20.369 m, Y −4.796…165.593 m, Z −34.466…17.521 m. Y is vertical. This is authored model scale, not surveyed building dimensions.
- The main interior geometry is joined in `Interior_Top` across many stories. Object names do not supply independent floor nodes, so hiding upper objects cannot reliably isolate a floor.
- **32 strong tower floor candidates** from Y≈7.175 m through 145.231 m. These are detected model surfaces, not verified real-world story numbers or a final list of every occupiable level.
- Adjacent tower elevations differ by **4.3678–4.4936 m**. Footprints expand and contract: approximately 651 m² at C01, 1,068 m² at C17, and 517 m² at C32. Triangle areas are geometric surface measurements, not approved usable area.
- Repeated tower underside/top pairs are approximately 0.700 m apart. Sampled clearance is about 3.75 m at C01 and 3.57 m at C32. The first candidate's nearest lower horizontal surface gives a different separation; its structural interpretation needs review. Do not use a universal slab thickness or confuse slab pairing with usable headroom.
- Lobby geometry includes upward surfaces near −4.217 m and −0.213 m. A 100 m² area cutoff finds the large ground plane but misses the roughly 72 m² raised lobby surface. Ground also merges sidewalk and lobby geometry at the same elevation. Height clustering alone therefore cannot label indoors, detect all split levels or declare walkability.
- Roof surfaces also pass the broad horizontal-area filter. Upper tower footprints have roughly 9–13% of sampled points without a downward horizontal surface directly above. This may include exposed ledges or tapering exterior regions; it is not evidence that those points are safe indoor placement zones.
- Images account for 32.4 MB of encoded bytes. Their dimensions imply approximately **728.5 MiB** if all are separately resident as RGBA8 textures with full mipmaps. This is a size estimate, not measured GPU memory; the engine's formats, mip policy, sharing and additional render targets affect actual memory. Repeating a self-contained GLB per story would be wasteful.

[Saved measurements](../../evidence/skyscraper-floor-probe.json) contain all candidates and the source identity. The local [geometry analysis figure](../../../.scratch/skyscraper-research/floor-detection.png) shows elevations, changing footprints and unequal spacing. It is a plotted geometry diagnostic, **not a screenshot of a working integration**.

### Diagnostic method and limits

Decoded actual indexed triangles and accumulated scene-node transforms; no negative-determinant transforms were found in this file. Selected nearly horizontal faces (`abs(normal.y) > 0.995`, vertex height spread <3 cm), clustered elevations within 4 cm, and inspected clusters above 100 m². `Interior_Top` provenance identified the 32-candidate tower subset. Used true projected triangle barycentric inclusion at 50 cm sample centers to compare floor surfaces with downward-facing overhead surfaces. This is model-specific exploratory analysis, not a generic production detector. Sampling can miss narrow obstacles, holes and sloped ceilings; vertical walls, body-volume collisions, access and supported furniture footprints were not validated.

Research scripts and raw logs are under `.scratch/skyscraper-research/`. They read the original model and write diagnostic artifacts only. The candidate count and plotted footprints are not integration acceptance results.

## Proposed integration

### 1. Detect and review spatial metadata offline

1. Decode indexed geometry, all node transforms and winding orientation; normalize to one metre/Y-up world frame. Support or explicitly reject compressed, sparse, skinned and nontriangle input. Do not assume the exploratory parser covers all glTF assets.
2. Cluster horizontal surfaces by elevation and spatial overlap/connectivity. Use area as evidence, not a hard rule excluding small mezzanines. Inspect roofs, sidewalks, stair treads and disconnected islands separately. For noisy captures, plane fitting can propose candidates but still needs review.
3. At each candidate, raycast downward for support and upward for local headroom. Use spatially overlapping surfaces to distinguish slab underside, floor top and the next ceiling. Include sloped ceilings and intermediate beams in the final clearance map. A BVH-based implementation can reuse Blender's existing `BVHTree` preparation pattern; [Open3D's raycasting documentation](https://www.open3d.org/docs/release/tutorial/geometry/ray_casting.html) is an alternative reference, not a proposed mandatory dependency.
4. Derive conservative furnishing zones from full triangle coverage, walls, pillars, openings and voids. Keep walking clearance distinct from furniture footprint clearance. Preserve holes when converting to rectangles; never fill a missing floor by using the building bounding box. Current limits are 256 free rectangles and 512 obstacles per context. Split into reviewed zones if necessary.
5. Record stable floor/zone IDs, elevations, local origins, clearance, confidence, review status and source hash. A reviewer confirms or edits the generated levels and entrance/window references before placement is enabled. Calibration confidence and segmentation confidence must be separate fields.

### 2. Reuse local floor coordinates

Proposed building metadata links one visual asset to many floor contexts. For a floor origin `(ox, elevation, oz)` in model metres:

- `localCm = 100 × (worldMetres − floorOriginMetres)`.
- The visual building transform is the negative floor origin in centimetres, with existing metre-to-engine scaling.
- Current furniture stays at local Y=0; the camera starts at local eye height in a verified navigable location.
- Each accepted level/zone gets a stable ID such as `london-c17-zone-a`, its own spatial data, conservative clear height and geometry revision. Reviewed names can later replace candidate labels without changing identity.

Keep the original GLB and all material/UV/image data intact. In the first implementation, load the whole building for first-person views and show the existing spatial plan for the active floor. Extend the package allowlist to share one building-owned visual URL between its declared floor contexts; do not loosen arbitrary path access. Cache the asset within the active renderer. Switching contexts currently recreates renderer ownership, so persistent cross-floor GPU caching would need explicit lifecycle work.

For a later rendered cutaway or whole-building overview, partition joined geometry into floor segments while retaining shared materials/textures, or implement verified clipping. Do not assume each original node corresponds to a floor. Whole-building furniture display must compose every local floor transform; current `applyFurniturePose` alone cannot place an overview's objects at multiple world Y elevations.

### 3. Give the designer real floor context

Replace mock references with the selected floor's actual walls, doors, windows, placed objects and reviewed zones. Supply a compact structured summary plus revision-matched perspective/plan images to a scene-aware designer. Keep coordinates and physical validity authoritative in deterministic tools; do not ask the language model to infer exact heights from images.

A building request should enumerate reviewed floors, generate proposals per floor, validate each proposal through `try_place`, and retain results per room ID with review/undo. Explicit floor identity must travel with commands, captures and revisions to prevent a floor switch from applying a stale edit to another floor. Preserve existing cart confirmation behavior.

Current acceptance caps are 100 instances per room and 1,000 returned products in the frontend snapshot parser. A whole-building demonstration therefore requires deliberate batching and performance measurement; it is not proven by rendering the empty model. Continuous stairs/elevators and arbitrary vertical furniture stacking would require additional navigation/pose work and are outside the initial floor-selector approach.

## Verification plan for a future implementation

| Check | Required evidence |
| --- | --- |
| Detection | Side elevation overlays for every proposed level; review lobby and roof separately; compare detected surfaces to source geometry at multiple X/Z positions. Perturb spacing and slab thickness in a small synthetic test so fixed-spacing assumptions fail. |
| Three representative floors first | Test C01, C17 and C32 with their different footprints, then lobby zones and remaining accepted levels. A source-textured first-person screenshot and matching labelled plan for each. |
| Placement validity | Supported object succeeds; object across an edge, hole, pillar or low ceiling fails. Backend and frontend agree. Capture the valid result and visible rejected attempt. |
| Floor isolation | Place different items at the same local X/Z on two levels; switch, reload and undo. Both layouts and cart identities remain independent. Stale commands and captures are rejected. |
| Texture preservation | Source GLB hash unchanged; same image/material/UV data; reference and integrated screenshots at matching cameras. Retain existing baked texture shadows; do not neutralize materials. |
| Performance | Measure cold/warm asset load, frame-time percentiles and memory with 0, 10, 50 and 100 active-floor items; benchmark the separate all-floor overview before claiming whole-building scale. |
| Runtime identity | Canonical `run-local.sh` on dedicated ports, verify serving checkout/commit and asset hash, exercise real selection → design → save → reload → capture path. Stop test servers afterward. |

## Checks actually completed

- `./setup.sh` succeeded on the fresh-main worktree.
- `OPENAI_API_KEY= DEEPGRAM_API_KEY= ELASTIC_URL= ELASTIC_API_KEY= COMPILE_LIVE_TEST=0 uv run python manage.py test` → `Ran 240 tests in 8.709s` / `OK (skipped=4)`.
- `npm test` → `tests 139 / pass 139 / fail 0`, then `tests 16 / pass 16 / fail 0`.
- `npm run build` → `built in 2.83s`, with the existing large-chunk warning and missing optional prepared-room asset warnings.
- Read-only GLB inspection and diagnostic floor projection completed; analysis figure visually inspected.
- **Not performed:** application integration, general floor detection validation, furniture placement on this skyscraper, browser screenshots of an integrated workflow, or performance benchmarking. No application server was started. These are future acceptance steps, per the user's research-only scope.

## GLB placement on or inside other GLBs

Follow-up source inspection confirms that GLB furniture can be placed inside a prepared GLB room using its reviewed floor data. Arbitrary object-on-object or object-in-object placement is not implemented. `frontend/src/region/clauses.ts` explicitly sets `ALLOW_STACKING = false` and drops an `on(instance)` clause; `clauses.test.ts` asserts this behavior. The persisted pose has no vertical coordinate, furniture renders at Y=0, and the backend rejects overlapping X/Z footprints regardless of vertical separation. A cabinet cavity or tabletop therefore needs explicit support/container geometry, a vertical position and support relationship, and corresponding picking, collision, save/restore and parent-movement rules. Merely enabling the flag would leave rendering and backend validation incompatible. This was a source review; no application code or test behavior changed.

See [supported object placement research](../3d-object/supported-object-placement.md) for the specific lamp-on-table and object-in-cabinet design and primary references.
