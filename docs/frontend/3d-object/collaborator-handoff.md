# Furniture 3D asset collaborator handoff

2026-09-19 · FRIDAY · Proposed asset contract for the first integration.

## What to build first

Please deliver **one sofa and one table** before building the full catalogue. We will use those two assets to verify scale, materials, placement, rotation, and independent duplicates in the browser.

Your scope is the furniture models, textures, product dimensions, and preview images. The frontend workstream owns the test room, grid, loading, selection, camera, and manipulation. Another teammate owns room reconstruction. Spatial validation and the valid-space overlay follow later; you do not need to build them.

The selected frontend direction is now first-person PlayCanvas with a SuperSplat-prepared fixed room. The current runtime remains Three.js until the migration is implemented. Continue delivering ordinary GLB furniture meshes; SuperSplat handles the scanned room, not this furniture deliverable. PlayCanvas recommends GLB for models. Keep an editable Blender source, correctly scaled mesh, PBR textures, centimeter dimensions and a floor-centered pivot. First-person viewing makes backs, undersides, texture detail and materials at close range especially important. [PlayCanvas model guidance](https://developer.playcanvas.com/user-manual/assets/models/building/)

## Approved visual reference

![Approved warm Atelier furniture and room reference](../design/images/06-warm-atelier-glass.png)

Use this image for the furniture's material, color, and silhouette direction: Japandi and wabi-sabi, a low sculptural rust/terracotta upholstered sofa, pale travertine or warm stone coffee table, and natural oak/woven lounge chair. Deliver the sofa and table first; the chair is a later catalogue item. Aim for tactile fabric, subtle stone variation, soft edges, and realistic roughness. Avoid baking the pictured sunlight and shadows into the materials.

This is a generated design reference, not a measured product drawing. Choose and declare actual dimensions; keep the thumbnail consistent with the delivered GLB. The image's room, glass panels, and controls belong to the frontend team. You do not need to recreate the app or room. The warm ivory/terracotta/espresso direction is approved; exact model geometry depends on the delivered assets.

## Creation routes

| Starting point | Approach |
| --- | --- |
| A suitable existing model | Use a licensed/team-owned model; import into Blender and check scale, geometry, and materials. |
| Simple table, shelf, or cabinet | Model in Blender, manually or with a script. Prioritize correct proportions and clean edges. |
| Product photographs or a complex upholstered form | Try Higgsfield's actual image-to-3D/multi-image-to-3D capability, then inspect and correct the mesh in Blender. |

Use Blender as the final inspection/export step regardless of how the model was created. A product render or turntable video is not the deliverable: we need geometry that the user can view from different angles and move inside the room.

Higgsfield's catalogue was checked on 2026-09-19 and included Meshy GLB generation from a single image or 1–4 images of the same object. For furniture, enable texturing and PBR maps; leave rigging and animation off. Check current model options when submitting. Use consistent views of the same furniture; inspect backs, undersides, legs, and thin surfaces because generated geometry may invent or merge details. Generated dimensions must be checked against the intended product dimensions.

Start with the route that produces one usable asset fastest. Do not spend the whole milestone learning detailed sofa modeling if a suitable source asset or generated draft is available.

## Deliverables per product

- `model.glb`: one product with embedded textures and a single top-level root containing its parts. Keep room geometry, background planes, cameras, and studio lights out of the export.
- `thumbnail.png` or `thumbnail.jpg`: a clear preview of the delivered model, matching its shape and color.
- `metadata.json`: stable product ID, dimensions in centimeters, and the agreed asset convention. Example below; fields are proposed, not an existing backend API.
- Editable source, such as `source.blend`, and the original reference images when available. Keep large authoring files out of the frontend's public asset folder; agree storage with the team.
- Source/creator/license details so the team knows where the asset came from and what reuse is permitted. Put any Markdown notes under an appropriate `docs/` folder and index them in the root `INDEX.md`.

Canonical runtime location: `shared/models/furniture/<product-id>/`. Keep one copy here for frontend rendering and backend asset tooling. Browser URLs remain `/models/furniture/<product-id>/model.glb` (and corresponding thumbnail paths). Vite serves these assets during development and emits them into `frontend/dist/models/furniture/` during production builds. Do not duplicate furniture files under `frontend/public/`.

Only GLB/glTF, BIN, PNG/JPEG/WebP and KTX2 runtime files are published. Metadata JSON and authoring files are not published by this bridge. Product dimensions still come from `shared/scene-fixtures.json`; automatic GLB dimension extraction is not implemented. Avoid symlinks. The separate couch worktree should adopt this path when integrating its assets.

```json
{
  "productId": "demo-sofa-001",
  "modelUrl": "/models/furniture/demo-sofa-001/model.glb",
  "thumbnailUrl": "/models/furniture/demo-sofa-001/thumbnail.png",
  "widthCm": 200,
  "depthCm": 90,
  "heightCm": 80,
  "assetUnits": "meters",
  "upAxis": "+Y",
  "frontAxis": "+Z",
  "pivot": "floor-footprint-center"
}
```

These dimensions are an illustrative placeholder, not a real merchant listing. For demo products, choose and declare dimensions deliberately; for real products, use verified measurements. Prices and cart behavior belong to the catalogue/commerce contract and are not invented here.

## Dimensions, axes, and pivot

- Measure width along X, height along Y, and depth along Z in the exported asset. Front faces +Z. Check the exported result; Blender's authoring axes differ from this convention.
- Put the root pivot at the center of the footprint at floor level: bottom of the furniture at Y=0, X/Z footprint centered around the root. The pivot is not the center of the furniture's volume.
- Export physically scaled GLB geometry. GLB/glTF uses meters: a 200 cm sofa should be 2 m wide in the exported file. The application metadata can still say `widthCm: 200`.
- Our scene scale is configurable: `SCENE_UNIT_CM=5` means one scene unit represents 5 cm. The frontend applies `100 / SCENE_UNIT_CM` to meter-based GLB coordinates. That 2 m sofa therefore becomes 40 scene units wide.
- **Do not scale the exported sofa to 40 m to match the grid.** Keep the asset independent of scene configuration; changing the test scale should not require re-exporting furniture.
- Apply intended object transforms during preparation and re-check dimensions/pivot after export. Changing Blender's unit display alone does not prove the exported file has the correct physical size.
- If your pipeline cannot produce this convention, report its exact units, axes, pivot, and transform. Agree an import correction before making the remaining assets; do not rely on the frontend guessing.

## Materials and initial budgets

Use glTF-compatible PBR materials with base color, roughness, metallic, and normal maps as needed. Bake unsupported procedural materials to textures. Check the exported GLB under browser lighting; a good Blender render does not guarantee the same material survived export. Avoid baking the entire studio lighting or floor shadow into the furniture's color texture.

Initial targets for the laptop demo, subject to measurement:

| Item | Target |
| --- | --- |
| Typical furniture | About 10–30k triangles |
| Hero sofa | Up to about 50k triangles if the detail matters |
| Texture dimensions | Prefer 1024 or 2048 pixels per side |
| GLB size | Aim below 5 MB per product |

These are starting budgets, not engine limits or automatic rejection thresholds. Share a first asset before sacrificing necessary detail. Start with standard embedded PNG/JPEG textures; agree any extra compression/decoder requirements with the frontend owner.

## Automated asset check (added by Saketh's lane, 2026-09-20)

Every folder under `shared/models/furniture/` with a `metadata.json` is checked by `backend/api/test_furniture_assets.py`, part of the normal backend suite:

- `metadata.json` names a real catalogue listing in `catalogueListingId`, and that listing's `model_url` points back at this model.
- The GLB's bounding box matches the listing's `dims_mm / 10` within **2 cm or 3%, whichever is larger**. The tolerance is loose on purpose: the check exists to catch the 2.6× class of error (a generator that normalises to a unit cube, an export in centimetres), not to police two percent.
- The lowest point is on y = 0 (±1 cm) and the footprint is centred (±2 cm).
- Under 5 MB and at most 30,000 triangles. **Aim for 10–15k**: 30k is the ceiling for one item, and a furnished room has many. If several assets land, run them through `gltf-transform` before they go in the repo.

Generated models usually arrive normalised around the origin. `python3 scripts/fit_glb.py <model.glb> <height_cm>` scales one **uniformly** to its true height, centres it and stands it on the floor by adding a root node: lossless, and safe to re-run after a re-export. It never stretches a model to force its box to match.

## Acceptance check before expanding the catalogue

- Open/re-import the exported GLB and confirm that textures and all furniture parts are present.
- Compare its physical bounding dimensions with the declared dimensions, including protruding arms or legs. Report any intentional mismatch; do not silently distort proportions to fit metadata.
- Inspect all sides, particularly legs and the underside; remove stray geometry and accidental background surfaces.
- Verify the floor pivot, +Y up, +Z front, and absence of unwanted cameras/lights.
- Hand off the sofa and table together with metadata, file sizes, triangle counts, and any known limitations.
- Frontend integration check: correct size on the 5 cm grid; furniture sits on the floor; rotation happens around its base; two copies move independently; materials look reasonable from multiple angles.
- Integration remains pending until these checks run in the actual app. The current frontend foundation has not yet implemented the full loader/manipulation workflow.

The immediate handoff questions are which creation route you are using, when the first two GLBs are available, and whether the proposed units/pivot/orientation are achievable. No renderer implementation is required from the furniture collaborator.

## References

- [Rendering workflow comparison and research](../rendering-and-furniture-workflow.md)
- [Higgsfield image-to-3D workflow](https://github.com/higgsfield-ai/skills/blob/main/higgsfield-generate/SKILL.md)
- [Meshy image-to-3D documentation](https://docs.meshy.ai/en/api/image-to-3d)
- [Blender glTF export documentation](https://docs.blender.org/manual/en/dev/addons/scene_gltf2.html) — use documentation matching your installed Blender version.
- [glTF coordinate system and units](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)
