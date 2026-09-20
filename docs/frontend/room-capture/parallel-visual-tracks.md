# Parallel mesh and Gaussian-splat proofs

2026-09-19 · Sin · Work allocation, not an approved renderer migration.

## Decision

Run two bounded visual proofs against the existing PlayCanvas editor. This task owns the Cg Arch mesh and Lightmapper trial. A separate user-owned task can own Gaussian-splat asset preparation and quality. Keep placement, furniture assets, Atelier UI and Django contracts shared; do not build two complete applications.

The local checkout is `codex/gaussian-splatting` and has substantial uncommitted implementation. Its branch name does not assign ownership. A new worktree made from HEAD alone will not contain this pending work. Until a reviewed checkpoint is committed, the second task should read this checkout and prepare separate artifacts without editing the shared renderer. Do not switch this checkout or copy over another task's working files.

## Ownership

| Track | Owns | First gate |
| --- | --- | --- |
| Current task: mesh | Isolated The Lightmapper compatibility check and one wall/cabinet proof; source material and lighting export | Smooth surfaces in the actual browser, without replacing the default room during the trial |
| Separate task: splat | Prepared splat quality, asset size, camera-safe region, fixed geometry/reference alignment and attribution | Good room appearance at eye height with the real sofa, without obvious holes or depth artifacts |
| Current coordinator | Shared renderer integration, UI, captures, performance comparison and final fixture selection | One working demo with valid placement, invalid rejection, persistence and captures |
| Existing reconstruction collaborator | `room_mesh/` and its video-to-mesh pipeline | Independent ownership; neither visual track modifies it |

Parallelize inspection, source preparation, documentation and code review. On this Mac, serialize heavy baking/training: do not run two GPU/CPU reconstruction jobs simultaneously. Separate sessions do not create extra physical memory or compute. Keep one active benchmark tab and no duplicate development stack unless explicitly needed.

## Shared contract

- State and API coordinates are centimeters; the configurable grid step is 5 cm. GLBs remain in meters and convert once through existing units helpers.
- Furniture uses the existing `modular-sofa-grey-scan` product and shared GLB; do not change its measured dimensions to hide alignment errors.
- Room appearance is fixed. `manifest.json` owns transforms/camera/attribution, while reviewed `spatial.json` owns free floor and fixed obstacles. Splat appearance alone is not collision geometry.
- Keep each fixture's room ID, geometry revision and saved layouts distinct. Do not reuse the Cg Arch identity for a different room.
- Use immutable, versioned visual filenames for each proof. Replacing bytes at the same URL leaves existing tabs holding old GPU resources; an old tab can then claim a screenshot job for the same room. HTTP cache headers do not fix this. Run screenshot comparison with one current worker tab per room/session. Change geometry revision only for geometry changes, not just lighting or texture updates.
- Use the current placement and screenshot tools described in [the engine contract](../../backend/contracts/spatial-engine-tools.md). No backend schema changes without coordinator agreement.
- Work from licensed existing assets first. Phone-video reconstruction or training a new splat is a later experiment, not a prerequisite for the first demo.

## Suggested message for the separate Gaussian task

> Own the Gaussian-splatting route for FRIDAY. Read INDEX.md, TODO_SIN.md and docs/frontend/room-capture/gaussian-splatting-handoff.md, then execute that handoff. Find a free, licensed downloadable splat resembling the bright, mostly empty Cg Arch interior, or fully convert the original Blender mesh scene with complete interior walkthrough coverage. Studio 11 is only a baseline. The other task owns the mesh/Lightmapper route. Keep the shared UI/backend and geometry contracts intact; coordinate before overlapping edits or heavy jobs. Deliver the real asset, aligned fixed geometry, source/license, coverage screenshots and measured performance. Do not claim a partial shell or single-view result is a complete conversion.

The [dedicated Gaussian handoff](gaussian-splatting-handoff.md) is the authoritative brief and includes source paths, conversion requirements and acceptance criteria.

## Compare evidence, not labels

Use the same browser window size, the same sofa and the same interaction sequence: load, look around, place/rotate/move furniture, reject an invalid pose, reload a saved layout, capture perspective and schematic views. Record asset bytes, load-to-ready time, 30 seconds of actual motion, p95 frame intervals, and screenshot duration. State whether loading was warm/local or cold/network. Exclude active bake/training jobs for the final performance comparison.

Studio 11 and Cg Arch are different scenes, so screenshots are a product-quality comparison, not a controlled reconstruction-accuracy benchmark. Compare calibrated accuracy only when both representations derive from the same room and reference measurements. Reject either track if it looks good only at one camera angle, has unsupported fit claims, or cannot complete the editing journey.

Run the Lightmapper gate on one wall/cabinet before processing the room. Compatibility failure or another visibly defective small proof is a reason to stop and report, not to begin an unbounded addon rewrite. A real-time-ready room is the fallback if neither current source is viable within the demo budget.
