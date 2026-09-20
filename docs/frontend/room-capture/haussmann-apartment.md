# HAUSSMANN APARTMENT test fixture

2026-09-19 · Owner: Sin · Work log: TODO_SIN.md

## Decision

**Go for the optional authored demo; metric scale remains unverified.** The 2026-09-20 quality fix resolves stale-sort smearing in the tested downward, ceiling and close-window captures. Final motion measured 53.5 FPS at full 1280 × 720. Keep the assumed-scale label and mesh fallback; no original Blender conversion or measured real-world fit is claimed. The evaluation card remains incomplete for the outstanding scale evidence.

All four owner TODO files point to [HAUSSMANN APARTMENT](https://superspl.at/scene/4de797f4). SuperSplat download may require login. The user supplied `~/Downloads/HAUSSMANN APARTMENT.zip`; its bundled license credits **Stéphane Agullo (sa3d)** under **CC BY 4.0**, including commercial reuse with attribution. Preserve `shared/rooms/haussmann-apartment/license.txt` and the runtime credit.

## Actual asset and reproducible preparation

The creator ZIP is 455,283,594 bytes and contains `scene.ply` (455,283,057 bytes) plus its license. The binary PLY has **2,995,277 Gaussians**, scales, opacity, quaternions, DC color and 24 higher-order SH properties (SH2). It is not a positions-only point cloud.

Source SHA-256: `167fbe4c98379cb92b9f36c91463a3fb4ead84dc91cccf0dac58d82365a69e38`.

From the repository root, after `./setup.sh`:

```sh
python3 scripts/gaussian_room/prepare_haussmann.py "$HOME/Downloads/HAUSSMANN APARTMENT.zip"
python3 scripts/gaussian_room/review_surface.py
BACKEND_PORT=8222 FRONTEND_PORT=5222 ./run-local.sh
```

Open `http://localhost:5222/?room=haussmann-apartment`; append `&perf=1` for the development observer. Preparation uses the pinned SplatTransform 3.4.2, checks the exact reviewed source hash and license, preserves all Gaussians without cropping/decimation, and produces a complete SOG plus a separate 5 cm voxel-shell reference GLB. It refuses to overwrite an existing immutable SOG; preserve existing assets before repeating. Generated binary assets are ignored by Git. Each teammate must run preparation locally after downloading the ZIP. The existing Cg Arch room importer is specific to that room and cannot import this fixture.

Generated files under `shared/rooms/haussmann-apartment/assets/`:

- `room-full-167fbe4c9837.sog`: 43,110,214 bytes in the reviewed run, SHA-256 `babdd467cfb303f3af58cd1d5d0e2544f0fd7bf630d28685d9b175a6e969b54c`.
- `surface-full-167fbe4c9837.collision.glb`: approximately 4.6 MB, 137,028 vertices / 268,534 triangles. This is a reference shell, not automatically approved traversable geometry.
- `preparation.json`: archive/source/output hashes, exact byte counts, tool version and calibration caveat. GPU clustering produced different compressed bytes on a successful repeat run (43,112,559 bytes); the original browser-reviewed SOG was restored for delivery. Both run reports remain in local scratch. The source hash is the review identity.

## Transform and reviewed space

Source units are **assumed meters**, not independently measured. Calibration stays `synthetic_demo`; do not make real-world fit claims. Visual transform is rotation `(0,0,180)` degrees, scale 1, translation `(-140,0,145)` cm: API coordinates in meters are `(-source.x-1.4, -source.y, source.z+1.45)`. The voxel GLB is already converted to PlayCanvas Y-up by SplatTransform, so its loader applies the translation without the splat's extra 180-degree rotation.

Room envelope is 660 × 940 × 390 cm; default eye-level camera `(400,160,200)` cm, yaw π, pitch 0, FOV 65°. Geometry revision is `haussmann-reviewed-demo-v1`. The floor/body review projects the generated shell at 5 cm and verifies every committed free-area cell has floor support and no body obstruction. Approved interior is x=40…480, z=60…870 cm, with six unsupported 5 cm cells deliberately removed: `(31,85), (32,85), (52,52), (54,77), (54,78), (85,136)` in grid coordinates. Fifteen rectangles encode that union; unknown space remains rejected.

The window wall/recesses are fixed. Closed doors are not portals to adjoining rooms, and nothing beyond windows/doors is accepted as free floor. The shell is not a physics engine or a watertight reconstruction. Placement and walking continue to use the existing centimeter contracts and reviewed regions, including furniture obstacles and the configurable 5 cm grid.

## Integration and verification evidence

Work was prepared in `/private/tmp/HackMIT2026-haussmann` on `codex/haussmann-gaussian` from `9641a99`, then reconciled with fetched `origin/main` and merged into local main at `ae03845`. The original dirty checkout and cabinet work remain untouched. Shared integration is limited to the room selector in `frontend/src/SplatEditor.tsx` and a Haussmann-only `GSPLATDATA_LARGE` setting in `frontend/src/scene/playcanvas/runtime.ts`. The latter improves reverse headings that smear with compact unified storage. Original PLY and packed SOG standalone reverse renders were clean; this is a renderer-path issue, not justification for cropping the room. No production backend, mesh preparation, furniture dimensions, dependencies or default room changes. Reconciliation with fetched main required a narrow backend asset-test correction: the pre-existing generated sofa is checked against its scene fixture instead of inventing a retail catalogue listing, retaining its documented size/triangle ceiling.

Local ignored evidence is under `.scratch/gaussian/`:

- `haussmann-reverse-large.png`, `haussmann-windows-large.png`, `haussmann-sofa-large.png`: multi-position views with the real GLB sofa.
- `haussmann-floor-final.png`, `haussmann-ceiling-final.png`, `haussmann-trim-final.png`, `haussmann-window-close-final2.png`: final coverage checks. Floor/ceiling and glass-edge artifacts remain a quality blocker; close trim is soft. Do not use only the clean reverse screenshot as proof of complete coverage.
- `haussmann-plan-large.png`: existing-contract 1024 × 768 schematic top capture. Perspective captures also use the existing contract, revision 1, with explicit first-person cameras and ready image results.
- `walkthrough.gif`: 33.9-second sampled recording of actual camera drags and W/S inputs, 29 frames. It is a sampled coverage record, not a full-frame-rate video benchmark.
- `motion-performance.txt` and `.png`: final full-heading motion run, **23.7 frame-event FPS, p95 84.8 ms, 710 samples over 30.0 s**, canvas **1280 × 720**, warm load-to-ready **647 ms**. A separate mostly downward run measured 28.7 FPS / 55.3 ms p95. No heavy mesh or conversion job was running during either measurement; screenshots and browser automation add overhead. GPU time and cold-network load were not measured. Do not claim steady 30/60 FPS.
- `placement-results.json` and `invalid-final.json`: actual 270 × 86.4 × 76.4 cm sofa placed at `(250,600,0)`; moving its center to `(500,600,0)` rejected as `fixed_obstacle`, revision unchanged. Furniture was not rescaled. Floor contact appears aligned in eye-level views. No legal free-standing fixed obstacle exists for a behind-obstacle example; behind-wall/window positions are invalid. Full occlusion quality is not accepted while photographic capture defects remain.

Use only one current room/session capture worker. QA used separate development ports 5222/8222 and an ignored settings override with a unique session-cookie name to avoid other localhost stacks replacing the QA session. This is test isolation, not a runtime configuration change.

## Earlier search evidence

The creator-linked public 2.6 GB dataset was inspected via bounded ZIP ranges: 1,951 entries include RGB/depth/normal images, COLMAP and XYZ/RGB point clouds, not a ready trained splat. The first PLY header lacked Gaussian attributes; no license file appeared in that inventory. The authenticated SuperSplat asset supplied by the user resolved acquisition instead. The original Blender/Brush training route and Mesh2Splat were researched but not performed. Studio 11 remains a compatibility baseline, not the chosen visual target.

## Automated integration checks

Combined frontend: 110 scene tests and five packaging tests passed; auth: nine passed; production build passed with the existing large-chunk warning. The standalone room-mesh suite (11 tests) and room-bundle suite (four tests) passed. Post-merge verification on main passed 195 backend tests (one opt-in live skip), all frontend/auth tests, migration consistency and production build; see TODO_SIN.md. All room documentation is indexed. The Kanban evaluation remains Sin/incomplete for metric scale; the quality follow-up below supersedes the earlier photographic defects.

## 2026-09-20 quality follow-up

PlayCanvas 2.22.2 `frame:ready` does not wait for camera-only CPU sorting. Captures could read the previous camera's order, and an in-flight sort could swallow a newer camera request. The small pinned adapter now drains old work, forces one fresh sort, waits until its result is applied, and then waits for the drawn frame. Tests distinguish CameraComponent from the internal Camera used by the engine map, and cover stale jobs, unapplied results, cancellation and missing-manager timeout. Mesh readiness is unchanged.

Haussmann also enables the engine's radial sorting: looking around reuses the order, while translation still triggers sorting. No Gaussians were removed, no resolution was reduced, and full-precision storage remains enabled. This avoids redundant rotation sorts; it is not a claim that this switch alone explains the difference from the older benchmark.

Final evidence under `.scratch/gaussian/quality/` supersedes the earlier defective captures:

- `radial2-floor.png`, `radial2-ceiling.png`, `radial2-window.png`: visually checked clean contract captures at 896 × 672, with sofa dimensions unchanged. Tiny source edge softness remains; the severe smear is gone. The detailed 1024 × 768 floor PNG exceeded the existing 1.5 MiB capture limit, so it was explicitly requested smaller rather than relaxing the API limit.
- `source-floor.webp`, `source-window.webp`: matched standalone source renders confirming that broad smearing was a browser sorting issue. Source exterior is absent, so the browser clear color appears beyond the windows.
- `final-performance.txt` and `.png`: 53.5 frame-event FPS, p95 26.2 ms, 1,604 samples / 30.0 seconds, full 1280 × 720 backing canvas; warm-ready 569 ms. Actual drags and W/S input, no capture jobs or heavy conversions/tests during the run. The earlier 23.7 FPS is historical; system load and run variation prevent attributing the entire change to this patch. A preceding run measured 59.6 FPS but overlapped development reload/test timing and is not the final benchmark.

The [author page](https://superspl.at/scene/4de797f4) was checked again, including its description/comments and three linked workflow images. It says “Z-Depth (10m)”: that is a depth-guidance range, not a wall length or a guarantee of exported Gaussian units. The PLY has no unit metadata. Keep `synthetic_demo`; verification needs one author-provided dimension mapped to identifiable points, or source scene units plus export/alignment scale. No typical-door estimate was substituted for a measurement.

Verification: 112 frontend scene tests, five asset-packaging tests and TypeScript/Vite build passed. QA stack stopped; ports 5222/8222 checked without listeners. Quality changes are recorded on `codex/haussmann-quality`; scale remains unverified.
