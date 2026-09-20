# Gaussian-splatting task handoff

2026-09-19 · Owner: separate user-owned task · Work log: TODO_SIN.md.

## Goal

Own the Gaussian-splat room route for FRIDAY while the current task owns the mesh/Lightmapper route. Deliver a convincing first-person room resembling the selected Cg Arch interior: bright neutral walls, muted wood floor, daylight, clean architectural detail and largely empty floor for adding furniture. Existing cabinetry and architectural fixtures are acceptable and remain fixed.

The user explicitly wants either:

1. A **free, legally reusable, downloadable Gaussian-splat room found online** with this appearance; or
2. A **complete Gaussian-splat conversion of the current mesh scene**, preserving its appearance and full interior walkthrough coverage.

Studio 11 is a compatibility baseline, not the requested final visual target. Do not settle for its furnished appearance merely because it is already available. A gallery thumbnail or hosted viewer is not a usable deliverable without the actual authorized downloadable asset.

## Inputs

- Visual target: [Empty Interior Scene 2 by Cg Arch](https://www.blendkit.com/asset-gallery-detail/e58113ed-e234-4bc9-a75a-8a5bb3d5396e/).
- Local original source: `/Users/sllee/blenderkit_data/scenes/empty-interior-s_58cad544-dfc8-42a3-a831-59cb876eade3/empty-interior-scene-2_7a2d7efa-569e-4b53-b558-de1bc4701c5e.blend`. Verify it exists; do not edit it.
- Actual clean Cycles reference: `/tmp/cg-arch-source-reference.png` (temporary local evidence, not a portable source asset).
- Current mesh metadata: `shared/rooms/cg-arch-interior/{manifest,spatial}.json`.
- Existing Gaussian baseline: `shared/rooms/studio-11/`, supplied `/Users/sllee/Downloads/Studio 11.zip`, and `?room=studio-11`.
- Editable furniture: `shared/models/furniture/modular-sofa-grey-scan/`; actual dimensions 270 × 86.4 × 76.4 cm.
- Existing renderer: PlayCanvas inside React, with Atelier panels and Mori. Read the [implementation](playcanvas-implementation.md), [parallel ownership plan](parallel-visual-tracks.md), and [agent contract](../../backend/contracts/spatial-engine-tools.md).

The original source Blender appearance is the conversion target. Do **not** train or convert from the current blotchy browser lighting atlas and reproduce its defects. The source uses AgX High Contrast, exposure +2.961538 EV and material color operations that a plain GLB export initially lost.

## Route A: find a ready-made splat first

Search for empty or mostly empty modern apartment/living-room/interior Gaussian splats. Prefer an actual complete-room capture over a single object, exterior, staged furnished showroom or isolated viewpoint. Verify source, creator, download accessibility and exact license. Free-to-view does not mean reusable; a PLY must contain Gaussian attributes, not just mesh vertices or point-cloud positions.

Inspect the best candidates in the actual PlayCanvas renderer. Evaluate walls, floor, ceiling, window edges, nearby detail, holes/floaters and camera movement. Choose quality at usable eye-level positions, not only a distant orbit thumbnail. Record any existing furniture as fixed obstacles. State whether dimensions are measured, calibrated or merely assumed.

## Route B: fully convert the current scene

If no suitable ready-made room qualifies, evaluate a local mesh-to-splat workflow using the original Blender scene. This may involve a direct conversion method or many known-camera renders followed by splat fitting. Research actual tool support and laptop feasibility before launching a long job; do not present a file extension change or a panorama as a conversion.

For this request, complete conversion means:

- All interior regions and architectural components of the supplied scene remain represented: floors, walls, ceilings, cabinetry, doors/windows and adjoining spaces. Do not silently crop the scene to the demo placement rectangle.
- Views work from multiple interior positions and headings, including looking back, looking up/down, approaching trim and checking occluded corners. A single camera image or partial visible shell does not pass.
- Retain source metric scale and a documented exact mesh-to-splat transform. Keep the original mesh/reference geometry for support, navigation, occlusion review and placement validation; splats do not replace collision geometry.
- Match clean source lighting/material appearance. Document view-dependent reflections, glass, inaccessible surfaces or missing details that the selected method cannot preserve. “Complete” is a coverage gate, not a claim of lossless equivalence at every possible viewpoint.
- If full coverage cannot be achieved on the available laptop/time budget, report that limitation and keep the result experimental. Do not label a partial conversion finished.

Everything runs locally on laptops. No cloud training, paid generation or new capture requirement is assumed. Coordinate heavy jobs with the mesh task; both sessions share the same Mac resources.

## Integration and ownership

Own splat asset research, preparation scripts in a distinct path, splat-specific fixture metadata and this task's documentation. Coordinate before changing the shared renderer, UI, backend, dependencies or launch configuration. Do not touch the mesh bake scripts, default Cg Arch assets, `room_mesh/` or the couch worktree.

Current checkout has uncommitted implementation on `codex/gaussian-splatting`. Do not switch its branch. A new worktree from HEAD alone will lack that work; read the current checkout as needed and prepare isolated assets until ownership/checkpoint arrangements are explicit. Do not commit, push or start duplicate servers without a request.

Use unique fixture IDs and immutable visual filenames. Keep canonical centimeter API state and 5 cm configurable grid; do not rescale the sofa to fake alignment. Use reviewed floor/obstacle geometry for success/failure placement, not inferred empty-looking splat pixels. Coordinate the final `?room=...` integration with the current task.

## Deliverables and acceptance

- Actual supported SOG/PLY or complete streamed-SOG package; reproducible preparation steps and source/license attribution.
- Manifest transforms, camera spawn/bounds and honest calibration status; aligned reviewed geometry and fixed obstacles.
- Screenshots from multiple positions, plus a short walkthrough demonstrating coverage. For mesh conversion, compare matched source and splat cameras.
- One real GLB sofa correctly scaled and grounded, tested in front of and behind fixed surfaces where applicable; valid placement and a rejected invalid placement.
- Asset size, local load time and a 30-second moving-camera performance measurement at reported viewport/resolution. Exclude concurrent heavy jobs for final measurement.
- First-person and schematic top captures through existing contracts after integration. Keep only one current capture worker per room/session to avoid stale-tab results.
- Clear go/no-go recommendation, remaining defects and exact artifact paths. Record progress in TODO_SIN.md; index every new Markdown document in INDEX.md.

Start with a short candidate search and real-asset inspection. Do not rebuild the editor or launch lengthy mesh-to-splat training before establishing that it is the fastest viable route.
