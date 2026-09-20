# Grey sofa GLB integration

2026-09-19 · `codex/gaussian-splatting`

The active furniture catalogue now uses the textured `modular-sofa-grey-scan` model from the existing `codex/realistic-couch-model` worktree. Its GLB, metadata and thumbnail are copied byte-for-byte into `shared/models/furniture/modular-sofa-grey-scan/`. The source worktree is unchanged; this is an asset import, not a branch merge.

The collaborator generated the model using Meshy multi-image-to-3D through Higgsfield and normalized its root to meter units, +Y up, +Z forward and a floor-centered pivot. We retain the measured **270 × 86.4 × 76.4 cm** dimensions; the model is not stretched to match the earlier procedural target. Embedded PBR textures stay in the GLB. The file is 10,814,596 bytes (about 10.31 MiB), with 46,385 triangles. It is still a generated test asset, not a manufacturer-certified product.

`shared/scene-fixtures.json` registers the model URL and real thumbnail. `catalogueVisible: false` retires the primitive sofa/table/chair and scale-reference choices from normal catalogues. Their records remain for compatibility with existing saved scenes and diagnostic tests; existing objects are not silently resized or converted into unrelated furniture. The legacy `?testAssets` route can still expose diagnostic products. There are no replacement chair/table GLBs in the collaborator worktree.

The poor procedural sofa alternative was intentionally not imported. If the real GLB fails to load, the editor retains its explicitly labeled dimensioned fallback and retry control rather than treating a loading failure as a successful model render.

The collaborator preview on port 5181 was stopped at the user's request. The current first-person editor remains on port 5180 with Django on 8002. No branch switch, fetch, merge, commit or push was performed.

See [collaborator handoff](collaborator-handoff.md) for the asset contract and [PlayCanvas implementation](../room-capture/playcanvas-implementation.md) for the room renderer.

## Verification

GLB header/length, embedded textures and source/destination SHA-256 equality passed for the model, metadata and thumbnail. All 57 frontend tests and TypeScript/Vite build passed. The browser showed only the textured sofa in the active catalogue, loaded its embedded materials, accepted click-to-place, and rendered it in the scanned room. The temporary chair from our previous QA was removed; the sofa showcase pose was then dry-run validated and applied through the exact-coordinate backend tool at X 345 cm, Z 355 cm, yaw π/2, clear of the default camera. This also verified agent edits appearing in the browser through polling.
