# LISABO table + chair, HEKTAR lamp, STOCKHOLM mirror — delivery notes

2026-09-20 · Adelle · Two clean passes, two known failures, one orientation bug caught and fixed.

## What this is

Four assets matching **pre-existing stub catalogue entries** (`backend/catalogue/data/listings.json` already had these products with real declared dimensions, just `model_url: null`) — filled in `model_url` on those four entries rather than adding new catalogue rows:

- `shared/models/furniture/lisabo-dining-table-ash-veneer/` → `ikea-702.211.42`
- `shared/models/furniture/lisabo-chair-ash/` → `ikea-403.608.74`
- `shared/models/furniture/hektar-floor-lamp-dark-gray/` → `ikea-805.109.92`
- `shared/models/furniture/stockholm-mirror-walnut-veneer/` → `ikea-403.284.34`

All generated via Higgsfield `image_to_3d` (Meshy), `should_texture=true`, `enable_pbr=true`, then `gltf-transform optimize --compress false --texture-compress auto --texture-size 1024 --simplify --simplify-ratio 0.4` (all four raw exports were 8.3–9.9MB / 28.3k–30.4k triangles → 2.0–2.5MB / 11.3k–12.2k triangles). Geometry compression left off for the same reason as every asset this session: `backend/api/glb.py`'s `measure()` reads accessor min/max/count directly, and frontend decoder support for meshopt/draco is unconfirmed.

## Chair: passes cleanly

43.2 x 79.0 x 49.6cm measured against the real 44 x 79 x 50cm — 0.8cm/0.4cm off, comfortably inside the ~2cm tolerance. No issues.

## Mirror: found and fixed an orientation bug, then passes cleanly

The raw generated mesh had its thin axis on **Y (height)** instead of **Z (depth)** — Meshy reconstructed the round mirror as a disc lying flat on the floor, not a disc hanging upright on a wall. This is a different, more severe failure mode than the proportion misses seen elsewhere this session: naively running the usual height-fit on the raw mesh would have scaled the whole object by ~10.5x to force the wrong (7.6cm) axis up to 80cm, producing a mirror roughly 20 meters wide.

Caught this by inspecting the raw measured box before fitting, then applied a one-off lossless -90° rotation about X (same root-node-transform pattern as `fit_to_height`, no vertex/texture bytes touched) to swap Y and Z before running the normal height fit. After that: 80.0 x 80.0 x 3.2cm against the real 80 x 4 x 80cm — passes cleanly (0cm/0.8cm off). The rotation script was a throwaway, not checked into `scripts/`.

**Takeaway for future round/flat objects (mirrors, wall art, clocks, rugs):** always inspect the raw axis assignment before blindly fitting to a target height — a face-on product photo of a circular object gives the model no cue about which way is "up" in the real world.

## Table and lamp: FAIL the automated check, same class as the sofa/bed/coffee-table

| | Measured (after height fit) | Real product | Miss | Tolerance |
| --- | --- | --- | --- | --- |
| LISABO table width | 149.6 cm | 140 cm | 9.6 cm | ~4.2 cm |
| LISABO table depth | 79.9 cm | 78 cm | 1.9 cm | ~2.3 cm (passes) |
| HEKTAR lamp width | 103.5 cm | 31 cm | **72.5 cm** | ~2 cm |
| HEKTAR lamp depth | 32.4 cm | 31 cm | 1.4 cm | ~2 cm (passes) |

The lamp's miss is the largest of any asset this session. Likely cause: HEKTAR's lamp head sits on a long angled arm that reaches well past the tripod base's actual footprint — single-image reconstruction appears to have captured the angled arm's horizontal reach as the object's full width, rather than the narrow three-legged base that actually determines its footprint. Same single-photo reconstruction class already flagged and accepted this session for the sofa, bed, and coffee table; pushed anyway under the same standing direction rather than re-asking an already-answered question.

## Do not merge without fixing table and lamp

This branch has two assets that will fail `backend/api/test_furniture_assets.py`. The chair and mirror are genuinely done. Fix path for the other two is the same as always: `multi_image_to_3d` with 2-4 angle photos, ideally including a straight side profile for the lamp specifically (to disambiguate the base footprint from the arm's reach).
