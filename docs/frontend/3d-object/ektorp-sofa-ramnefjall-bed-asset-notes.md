# EKTORP sofa + RAMNEFJÄLL bed asset — delivery notes

2026-09-20 · Adelle · Pushed with a known, failing dimension check — read before merging.

## What this is

Two GLB furniture assets from Higgsfield `image_to_3d` (Meshy), `should_texture=true`, `enable_pbr=true`, then run through `gltf-transform optimize --compress false --texture-compress auto --texture-size 1024 --simplify --simplify-ratio 0.4/0.5` to bring the PBR export under the 5MB budget (raw output was 9.1MB / 11.2MB). Geometry compression (meshopt/draco) was deliberately left off: `backend/api/glb.py`'s `measure()` reads POSITION accessor `min`/`max`/`count` directly and doesn't decode compressed buffers, and the frontend's GLTFLoader configuration for meshopt/draco decoding is unconfirmed — plain accessors are the safe choice for both.

- `shared/models/furniture/ektorp-2-seat-sofa-hillared-dark-blue/` — IKEA EKTORP 2-seat sofa frame (001.850.32) + Hillared dark blue cover (305.170.87). Dimensions from the EU product page (not sold on ikea.com/us currently).
- `shared/models/furniture/ramnefjall-bed-frame-kilanda-dark-blue-queen/` — IKEA RAMNEFJÄLL upholstered bed frame, Kilanda dark blue, Queen (805.589.66). Dimensions and price ($249) from the official US product page.

Both were fit to their true height and floor pivot with `scripts/fit_glb.py` (same lossless uniform-scale approach used for the HERRÅKRA chair).

## This WILL fail `backend/api/test_furniture_assets.py`

Unlike the chair's gaps (missing PBR, unverified pivot — cosmetic/quality issues), this is a hard assertion failure:

| | Measured (after height fit) | Real product | Miss | Tolerance |
| --- | --- | --- | --- | --- |
| Sofa width | 165.0 cm | 179 cm | 14.0 cm | ~5.4 cm |
| Sofa depth | 99.4 cm | 88 cm | 11.4 cm | ~2.6 cm |
| Bed width | 180.1 cm | 162 cm | 18.1 cm | ~4.9 cm |
| Bed depth | 219.0 cm | 212 cm | 7.0 cm | ~6.4 cm |

Height matches exactly on both (fit scales to declared height by construction). The mismatch is real reconstruction error, not a units/scale bug: a single 2D product photo doesn't give Meshy reliable depth information, especially on soft, rounded upholstery where the true footprint isn't legible from one angle. Per `collaborator-handoff.md`'s own instruction — *"Report any intentional mismatch; do not silently distort proportions to fit metadata"* — these were **not** non-uniformly stretched to fake a pass.

**This was pushed anyway, at the requester's explicit direction, after being flagged and offered a fix (regenerate via `multi_image_to_3d` with additional angle photos).** If this branch is merged as-is, `test_furniture_assets.py` will fail on fresh `main` and needs to be fixed before landing, per the "red main is a whole-team stop" rule.

## Suggested fix

Regenerate both via `multi_image_to_3d` using 2-4 official product angle photos (available on the IKEA product pages linked above) instead of one image. No new input needed from the furniture owner — the extra angles can be pulled directly from IKEA. Until then, do not merge this branch into `main`.
