# FRIDAY product context

<!-- impeccable:product-schema 1 -->

2026-09-19. Confirmed from the user's decisions in this task and the [proposal](../../proposal.md). Implementation status is recorded separately in the [index](../../INDEX.md).

## Platform

web

## Users and purpose

FRIDAY helps a shopper inspect furniture in the context of a room, compare options, place a product and understand why a placement succeeds or fails. The room is the shared visual context for the shopper and spatial agent. The product is being developed as a four-person hackathon MVP; laptop interaction is the current target.

## Operating context

The selected next experience uses an existing Gaussian splat of a furnished room for the first demonstration. Ultimately a phone walkthrough of a real room supplies that environment. Existing scanned furniture remains fixed; newly selected products are separate editable objects. Reconstruction must run locally on laptops. A cloud or NVIDIA-only service cannot be a required processing step.

The frontend uses React and TypeScript with a Django API. The default renderer is PlayCanvas, using a local prepared Studio 11 splat and separate reviewed fixed geometry. SplatTransform prepares the visual asset and diagnostic surface mesh. The preserved Three.js/R3F editor remains accessible through `?legacy`. Movable furniture remains GLB, with shared asset storage and authoritative dimensions. Another collaborator owns realistic furniture models.

## Capabilities and constraints

- Preserve placement, undo/redo, save/reload, exact-coordinate agent attempts, failure reasons and dry runs.
- Agents need revision-specific images and a choice of inspection views, including top and custom 3D cameras. The scanned-room meaning of top view must be explicit.
- Scene poses and UI measurements use centimeters. Preserve `SCENE_UNIT_CM=5` as the default render scale and meter-authored GLBs. Catalogue dimensions use millimeters and need one explicit conversion boundary.
- A visible splat is appearance data; placement decisions require calibrated, reviewed spatial data. Unobserved space must not silently count as free.
- Search/constraint compilation exists in a separate catalogue lane. Full semantic placement execution and the video reconstruction pipeline are not yet integrated.
- Runtime implementation and screenshots must be tested with an actual room asset; a hosted gallery preview is not an accepted local fixture.

## Brand commitments

Keep FRIDAY branding, PP Mori and the approved warm Atelier liquid-glass panels and motion. The user explicitly confirmed retaining this UI while matching Ambic's room view and interactions. Replace the elevated Noir room-box presentation with an interior first-person experience. Preserve Japandi/wabi-sabi material direction where applicable to supplied assets; a captured room retains its actual materials.

## Evidence on hand

- Existing Three.js editor, Django engine contracts, tests and shared furniture fixture.
- Bundled user-supplied PP Mori files and original license; existing font-use limitations remain recorded in the design documentation.
- Approved Atelier references in `docs/frontend/design/images/` and a user-supplied Ambic room screenshot.
- Public room candidates and reconstruction research in the [room-capture research](../frontend/room-capture/research-and-integration-plan.md). The user supplied the licensed Studio 11 archive; local preparation, rendering, GLB composition and capture are implemented. Scale remains explicitly synthetic.

## Product principles

- Let the room and furniture lead; keep controls legible and secondary.
- One authoritative layout drives the viewer, validation, persistence and agent feedback.
- Keep camera navigation and furniture manipulation unambiguous.
- Report unsupported operations and incomplete evidence explicitly.
- Qualify one complete prepared-room workflow before widening input formats and automation.

## Open decisions

Measured real-world calibration and production furniture remain open. See the [implementation record](../frontend/room-capture/playcanvas-implementation.md) for the current prepared-room slice and the [migration plan](../frontend/room-capture/first-person-playcanvas-plan.md) for remaining gates.
