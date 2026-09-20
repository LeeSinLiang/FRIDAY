# Oak platform bed asset — delivery notes

2026-09-20 · Sin · Added to `main` alongside the existing RAMNEFJÄLL bed, not in place of it.

## What shipped

- `shared/models/furniture/oak-platform-bed/` — an invented low oak platform bed with oatmeal linen bedding. **172 × 188.2 × 84.9 cm**, 44,334 triangles, 3.42 MB, one material, four PBR maps.
- `demo-oak-platform-bed` in `backend/catalogue/data/listings.json` — a **synthetic `stub` listing**, not a real product.

This does not replace [Adelle's RAMNEFJÄLL bed](ektorp-sofa-ramnefjall-bed-asset-notes.md). That one is a real IKEA SKU (`ikea-805.589.66`) with verified dimensions and price; this one is a generic visual proxy. Replacing it was considered and rejected: it is referenced from two other work logs, the [collaborator handoff](collaborator-handoff.md) fit table, and a regression test whose literal numbers are that bed. The catalogue carries four bed listings; two of them now have models.

## How it was made

1. Four-view turnaround generated with the `codex-image` skill — front, three-quarter, side, rear on seamless white.
2. Cropped at **detected gutter boundaries** rather than fixed fractions; the views are not evenly spaced and fixed crops clip them.
3. Higgsfield `multi_image_to_3d` (Meshy), `should_texture=true`, `enable_pbr=true`, 45k target.
4. Uniform scale 0.990914 to fit width to 172 cm, plus a floor-pivot translation, applied by inserting a root node and rewriting only the glTF JSON chunk — the BIN chunk was copied byte-for-byte so textures never needed re-encoding.
5. `gltf-transform resize --width 1024 --height 1024`. **Resize only.**

Four views rather than one is why this needed no per-axis fit at all: the generator put the length on Z with the headboard already at negative Z, and landed within 1% of real-world scale.

## Two judgement calls worth knowing

**Textures were resized; geometry was not touched.** The mesh is 44,334 triangles against a 30,000 budget. `gltf-transform optimize --simplify --simplify-ratio 0.5` was tried and removed only 1% of triangles (44,334 → 43,822) — all of its saving came from texture downscaling, not decimation. Pushing simplification harder would work, but this model's realism is carried almost entirely by the duvet folds and pillow shapes, which is exactly what decimation destroys. So it takes a named triangle exception in `backend/api/test_furniture_assets.py`, pinned to its exact count, and needs no byte exception.

A 2048 vs 1024 comparison was rendered at identical camera and zoom, far closer than the editor ever shows a bed. The only visible difference is slightly softer oak grain. A lossless resize and a lossy re-encode were also compared: identical, including the faint speckle in the linen, which comes from the generator's own texture and is present in the original 10.1 MB file too.

**The declared size is what the mesh measures, not a queen.** At 188.2 cm deep the frame is short for its 172 cm width — the implied mattress is about 180 cm. Depth is the least constrained axis in image-to-3D. Reaching a 212 cm queen needs 12.65% anisotropy, over the 10% cap in `scripts/fit_glb.py`, so no per-axis fit was applied. Because the listing is synthetic there is no external truth to miss: it declares the honest measured size rather than a distorted one. If a true queen is wanted later, regenerate rather than stretch.

## Verification

- `python manage.py test api.test_furniture_assets` — 18 tests, all pass, including the binding check that a `generic_visual_proxy` may only back a synthetic listing.
- `python manage.py test` — **390 tests pass**, 5 skipped.
- One real failure was caught and fixed along the way: `catalogue.test_scale` asserts hero-feed colours are exactly the seed `PALETTE`. The first draft invented `#c8a87a` / `#e8dfd0`; they were replaced with the palette's own `#c9a77c` oak and `#e9e4d8` linen.
- Measurements read from the GLB with `api.glb.measure`, not from metadata: 172.0000 × 188.2225 × 84.8659 cm, lowest point at y = 0.0 cm, footprint centred.
- Loaded and viewed in the browser under the editor's `RoomEnvironment` lighting recipe.

## Known limitations

Recorded in full in the asset's `metadata.json` under `knownLimitations`. In short: over the triangle budget by exception; frame short for its width; single merged mesh so frame, duvet and pillows are not separately addressable; no Blender inspection pass; the `price_cents` on the stub listing is invented demo data.

## Related

- [Furniture collaborator handoff](collaborator-handoff.md) — asset contract, units, pivot, budgets.
- [EKTORP sofa + RAMNEFJÄLL bed notes](ektorp-sofa-ramnefjall-bed-asset-notes.md) — the other bed, a real SKU.
