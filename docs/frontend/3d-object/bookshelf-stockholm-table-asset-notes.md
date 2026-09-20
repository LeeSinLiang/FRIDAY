# Bookshelf + STOCKHOLM coffee table asset — delivery notes

2026-09-20 · Adelle · One clean pass, one known-failing pass (same class as the sofa/bed).

## What this is

- `shared/models/furniture/low-open-bookshelf-navy-oak-top/` — an **unidentified generic item**, not matched to a real product. Low, wide, open 3-column x 2-row bookshelf, navy/black body, oak-look top. Looked similar to IKEA SKRUVBY at a glance, but SKRUVBY is a tall single-column unit — wrong shape, ruled out rather than force-matched. Declared dimensions equal the fitted geometry's own measured box (164 x 65 x 46.3cm), which is the honest choice for a demo item with no real target to check against. Catalogue id `demo-low-bookshelf-navy-oak`, `source: "stub"`.
- `shared/models/furniture/stockholm-coffee-table-walnut-veneer/` — IKEA STOCKHOLM coffee table, walnut veneer (702.397.10), $449.99, 180x59x40cm, both verified on the official US product page.

Both generated via Higgsfield `image_to_3d` (Meshy), `should_texture=true`, `enable_pbr=true`, then `gltf-transform optimize --compress false --texture-compress auto --texture-size 1024 --simplify` (bookshelf raw was 7.3MB/23.6k triangles → 1.87MB/10.3k; table raw was 13.9MB/**30,686 triangles, already over the 30k cap on its own** → 4.1MB/22.4k). Geometry compression left off for the same reason as the sofa/bed: `backend/api/glb.py`'s `measure()` doesn't decode compressed accessors, and frontend decoder support is unconfirmed.

## Bookshelf: passes cleanly

No real product to check against, so nothing to fail. Triangle count (10.3k) and size (1.87MB) are both comfortably inside budget — this is the one clean pass out of the last two.

## Coffee table: FAILS the automated check, same as the sofa/bed

| | Measured (after height fit) | Real STOCKHOLM | Miss | Tolerance |
| --- | --- | --- | --- | --- |
| Width | 155.5 cm | 180 cm | 24.5 cm | ~5.4 cm |
| Depth | 53.1 cm | 59 cm | 5.9 cm | ~2.0 cm |

Same failure mode already documented for the EKTORP sofa and RAMNEFJÄLL bed on `codex/adelle-sofa-bed-assets`: single-photo reconstruction under-estimates the true elongation of the object (here, how oval/stretched the real tabletop is). Not a units bug; proportions were not distorted to force a pass. Pushed anyway under the same standing direction given for the sofa/bed, rather than re-asking for an already-answered tradeoff.

## Do not merge either branch into main without a fix

Both `codex/adelle-sofa-bed-assets` and this branch (`codex/adelle-bookshelf-coffeetable-assets`) contain at least one asset that fails `backend/api/test_furniture_assets.py`. The fix path is the same for all three: regenerate via `multi_image_to_3d` with 2-4 official product angle photos instead of one image.
