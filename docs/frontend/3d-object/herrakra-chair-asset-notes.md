# HERRÅKRA armchair asset — delivery notes

2026-09-20 · Adelle · First furniture asset pushed, delivered out of the agreed build order.

## What this is

`shared/models/furniture/herrakra-armchair-diseroed-dark-yellow/` — a GLB furniture asset generated from a single product photo via Higgsfield's `image_to_3d` (Meshy), with `should_texture=true`. Product: IKEA HERRÅKRA armchair, Diseröd dark yellow (40535547). Dimensions in `metadata.json` (71 × 66 × 73 cm) are converted from IKEA's official inch measurements on the US product page, not measured directly.

## Why this doesn't fully meet the collaborator-handoff spec yet

See `knownLimitations` in `metadata.json`:

- **No PBR.** `collaborator-handoff.md` asks for PBR maps; this asset has plain baked color/texture only.
- **Low-res source.** Generated from a 160×160px IKEA thumbnail, not a full product photo or multiple angles. Fine detail and thin-part accuracy (legs, seams) are not verified.
- **Pivot/axis unverified.** Declared `+Y up`, `+Z front`, floor-footprint-center pivot per the agreed convention, but the raw generation has not been opened in Blender to confirm or correct this.
- **Build order.** The handoff doc asks for a sofa and table before a chair. This chair was pushed first at Adelle's request, as a fast end-to-end pipeline check (upload → generate → push), not as the priority catalogue item.

## Suggested next step

Treat this as a pipeline smoke test, not a ready catalogue asset. Before relying on it in the room editor: open in Blender to check/fix pivot and axes, and decide whether PBR + a better source image are worth a regeneration pass. The sofa/table priority items still need to happen separately.
