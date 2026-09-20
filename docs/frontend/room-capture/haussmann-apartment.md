# HAUSSMANN APARTMENT Gaussian candidate

2026-09-19 · Gaussian workstream · Work log: TODO_SIN.md

## Decision and current gate

Prioritize this ready-made room over training a conversion. **Candidate only; not integrated or accepted.** The actual local splat download is still required. The hosted viewer is not a substitute for a delivered asset or FRIDAY verification.

- Creator: **sa3d**.
- Source and download: [HAUSSMANN APARTMENT](https://superspl.at/scene/4de797f4).
- Source page explicitly lists **CC BY 4.0**, a Download button and **41.57 MB**. Retain the downloaded package's license and attribution; verify they match before preparation.
- Creator describes an authored 3ds Max / Corona scene rendered from 644 cameras, with depth and normal passes, trained with LichtFeld Studio.
- Creator also links a [public source dataset ZIP](https://drive.google.com/file/d/1VV6-yuZKz1pMUitN63o-lQ9FY027E_o7/view). This is a dataset, not yet verified to contain a finished splat. Google Drive reports it too large to preview.
- Clicking SuperSplat Download in the current unauthenticated browser displays “Please log in to download this splat.” User was asked to download through their account and provide the local file path. No login gate was bypassed; no account created, contact information submitted or terms accepted.

## Initial visual inspection

Inspected the live SuperSplat renderer, paused the camera animation, and changed headings using camera drags. Observed bright neutral walls, herringbone wood floor, ceiling/crown moulding, multiple tall windows, closed panel doors, and a largely empty floor. This is substantially closer to the requested appearance than furnished Studio 11. Some window/door edges are soft.

These are preliminary heading checks in the creator's viewer, not a translation-coverage test. No claim is made yet about nearby trim, occluded corners, ceiling completeness, wall solidity, collision accuracy or visibility behind doors. Do not infer adjoining rooms behind the closed doors. Authored metric scale and source transforms have not been obtained. The displayed 41.57 MB is a website figure, not a locally measured asset size.

## Other routes checked

| Route | Finding | Decision |
| --- | --- | --- |
| [Apartment_SH3](https://superspl.at/scene/1e56ea8e) | Creator lists CC BY 4.0 and downloadable synthetic apartment | Lower priority; empty-floor fit not established |
| [InteriorGS](https://huggingface.co/datasets/spatialverse/InteriorGS) | Actual compressed Gaussian PLY scenes, structure and occupancy annotations; gated contact-sharing and custom terms | Not an immediately available unrestricted download; no access request submitted |
| [EA Mesh2Splat](https://github.com/electronicarts/mesh2splat) | Direct surface conversion; official build instructions cover Windows/Linux | Mac compatibility unverified; material sampling alone does not establish clean Cycles lighting fidelity |
| [Brush](https://github.com/ArthurBrussee/brush) | Official macOS support and known-camera COLMAP/Nerfstudio training inputs | Viable research fallback for original Blender multi-camera renders; no local training/runtime benchmark yet |

Search included public web queries and SuperSplat's Downloadable filter. Its “empty” results did not produce a suitable interior; “interior” produced this candidate. This is a bounded search, not a claim that no other suitable free assets exist.

## Preparation and integration ownership

Implementation references below describe the coordinator’s separate, unmerged working checkout as of 2026-09-19. This documentation merge does not ship that renderer, room assets, preparation scripts or asset-serving configuration. Recheck availability and server state before integration.

Use `scripts/gaussian_room/` for candidate preparation, local `.room-preparation/gaussian-room/` (ensure it is ignored before generating files) for inspection outputs, and proposed unique fixture ID `haussmann-apartment`. Do not create a served room manifest until its referenced assets and spatial metadata are real and verified; the shared build validates every room directory.

Coordinator confirmed the existing frontend at `http://127.0.0.1:5180` and backend on port 8002. Do not launch duplicate servers. Shared renderer/query selection remains coordinator-owned until a concrete fixture is ready. Mesh task is finishing its separate Lightmapper cabinet proof; coordinate before heavy conversion/training or final measurements.

After download:

1. Inventory the archive without executing contents; retain license, source URL, creator and SHA-256. Verify Gaussian attributes or complete supported SOG package, not just PLY positions.
2. Inspect source bounds, axes and floor. Establish a reproducible exact transform; distinguish authored/calibrated dimensions from assumptions. Never adjust the real sofa's 270 × 86.4 × 76.4 cm dimensions to hide scale errors.
3. Prepare immutable visual filenames. Preserve full source visual coverage; any decimation requires comparison. Generate/reference surface geometry separately from reviewed placement geometry. Empty-looking pixels are not evidence of free floor.
4. Review a conservative supported floor region, walls, closed-door limits and fixed obstacles. Keep all unreviewed space unknown. Record camera spawn, safe bounds and geometry revision.
5. Coordinate `?room=haussmann-apartment` integration; retain centimeter API and configurable 5 cm grid. Use only one current capture worker for the room/session.

## Acceptance evidence still required

- Actual local supported SOG/PLY package and repeatable preparation.
- Multi-position first-person views: forward/back, up/down, corners, close trim and windows; short walkthrough.
- Aligned reviewed geometry and calibration status.
- Correctly scaled/grounded actual sofa, front/behind fixed-surface occlusion where applicable, one valid placement and one rejected invalid placement.
- Local asset bytes, load-to-ready time, 30-second moving-camera frame measurements with viewport/resolution and concurrent heavy jobs excluded.
- Existing-contract first-person PNG and schematic top PNG.

**Current recommendation:** go for asset acquisition and local inspection; no-go for promoting this candidate as the completed room until those gates pass. Original Cg Arch source, default assets, mesh bake scripts, shared renderer/backend and couch worktree remain untouched by this workstream.
