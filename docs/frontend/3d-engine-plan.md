# 3D frontend foundation: reviewed build plan

> Direction update, 2026-09-19: the user selected a first-person PlayCanvas runtime with SuperSplat-prepared fixed rooms and GLB furniture. See the [selected pivot and reconstruction research](room-capture/research-and-integration-plan.md). The Three.js foundation below describes the existing implementation; it is not the target renderer for the next phase.

> Scope update, 2026-09-19: the user authorized green/red footprint placement checks, easier dragging, Django persistence, and agent command transport after the original foundation. These are now implemented; the original phase boundaries below are historical. See [implementation](editor-implementation.md) and [scene API](../backend/contracts/scene-api.md).

2026-09-19 · Sin · Foundation implemented with three subagents; see [implementation and verification](editor-implementation.md).

Stay on `feat/3d-engine-frontend`. Build a laptop room editor with a configurable grid, an empty test room, camera controls, and independent furniture manipulation. Keep the first integrated version small and usable, then improve asset quality. Product context: [proposal](../../proposal.md). Research: [engine and asset comparison](rendering-and-furniture-workflow.md). Furniture collaborator: [asset handoff](3d-object/collaborator-handoff.md).

## Decisions and scope

- Selected visual direction: [Atelier glass + Noir room + Japandi materials](design/selected-direction.md). Use PP Mori, a warm ivory shell, espresso typography, and terracotta controls, subtle liquid-glass panels with fluid formation from their triggers, and a contained warm plaster/wood/stone room with wabi-sabi texture. Prioritize a large viewport and one combined object/property sidebar. Font files remain to be acquired; the reference does not expand foundation functionality.
- Implementation default: existing React/TypeScript/Vite + Three.js/R3F, using the installed Three.js helpers directly. Preserve current compatible dependency versions; no framework migration or broad upgrades.
- App state and proposed JSON contracts use **centimeters**. Root environment setting `SCENE_UNIT_CM=5` means one render unit represents 5 cm. GLB assets retain their standard meter convention.
- First fixture: an empty 600 × 500 × 280 cm room. Furniture assets must not block grid/camera work; optional test sofa/table proxies come from local fixtures.
- This branch owns rendering, manipulation, and minimal data contracts. The furniture collaborator owns models; another teammate owns room reconstruction.
- Deliver add/select/move/snap/rotate/remove and undo/redo. Start with quarter-turn rotation buttons, numeric position controls, and optional one-unit snapping.
- Aim for convincing PBR materials, grounded shadows, and clean room presentation. The first slice uses simple geometry and local lighting; final visual assessment awaits supplied furniture assets.
- Defer physical placement validation, valid-space overlays, floor-plan reconstruction, scans/splats, live capture, AR/mobile, physics, arbitrary rotation handles, product search, agent transport, checkout, and server persistence.
- No green/red validity claims in this phase: objects can overlap or extend beyond the room. Reject malformed commands, not physically invalid placements.

## Review findings resolved

1. Removed conflicting meter-based app/API guidance. There is one centimeter state contract and one explicit meter-GLB conversion.
2. Replaced open-ended room normalization with a rectangular canonical fixture. Incoming reconstructed rooms get a later adapter; we do not build a general importer now.
3. Assigned committed poses/history to one state module; transient drag preview has one interaction owner.
4. Froze ownership boundaries so workers cannot independently change shared types, dependencies, scene composition, or app-shell files.
5. Kept verification focused on units, command history, model duplication/loading, and actual laptop interaction. No renderer benchmark claims or guaranteed parallel speedup.

## Canonical units and coordinates

Y is up; the floor is XZ. The room origin is a floor corner, with interior extents along positive X and positive Z. Furniture origins sit at footprint center on the floor. At zero yaw furniture faces +Z; positive π/2 yaw turns the front toward +X.

```text
cmToScene(cm) = cm / SCENE_UNIT_CM
sceneToCm(units) = units * SCENE_UNIT_CM
meterGlbToSceneScale = 100 / SCENE_UNIT_CM
```

At the default, room dimensions become 120 × 100 × 56 units. A 200 cm sofa becomes 40 units wide. At 10 cm/unit, these render sizes halve while all saved centimeter dimensions and positions stay unchanged.

Use a centimeter placement wrapper converted once to render coordinates. A model child gets the meter-to-render scale once. Proxies use metadata converted from cm; do not apply GLB scaling to proxies or scale the same mesh twice. Camera distances, near/far planes, grid spacing, shadows, and selection geometry must also derive from physical dimensions.

Expose only the validated scale number from root `.env` to the client; mirror its default in `.env.example`. Reject malformed, non-finite, zero, or negative values. A Vite restart/rebuild is required after changing it. Do not expose the complete root environment. The setting is implemented and tested at 5 and 10 cm/unit.

Fine grid lines occur every scene unit; stronger lines every ten units, with spacing labeled in cm. Fade/hide fine lines at distant zoom rather than showing dense flickering lines. Grid geometry should be batched, not one React component per cell.

## Minimal shared contract

The coordinator creates `frontend/src/scene/types.ts` and `units.ts` before dispatching implementation workers. All workers consume those files; changes go through the coordinator.

```ts
type Pose = { xCm: number; zCm: number; yawRad: number }
type Room = {
  roomId: string
  revision: number
  widthCm: number
  depthCm: number
  heightCm: number
}
type Product = {
  productId: string
  widthCm: number
  depthCm: number
  heightCm: number
  modelUrl?: string // absent: explicitly labeled test proxy
}
type Instance = { instanceId: string; productId: string; pose: Pose }
type SceneEdit =
  | { type: 'add'; instance: Instance }
  | { type: 'setPose'; instanceId: string; pose: Pose }
  | { type: 'remove'; instanceId: string }
```

These are implementation targets, not a live backend schema. Use finite positive dimensions, unique instance IDs, known product IDs, and finite poses. Invalid payloads leave state unchanged. Undo/redo operate on local edit history, separate from the serializable scene edits. No-op edits do not create history. New edits after undo clear redo.

Use a small reducer and React hook; no new global-state dependency unless a concrete integration problem justifies it. Selection, snap setting, and camera mode are transient editor state, not undoable product geometry. Camera controls, mesh references, and drag previews stay out of serialized scene data. Pointer motion must not rerender the whole app on every frame.

Future backend integration can wrap an edit with `commandId` and `baseRevision`. Do not implement HTTP endpoints, distributed deduplication, or a queue for this local foundation. Room reconstruction needs a separate agreement for floor origin, axes, physical dimensions, and named floor/wall nodes; the fixture does not wait for it.

## Interaction and rendering behavior

- A large scene viewport with a compact toolbar, selected-object controls, and clearly labeled test-object buttons. Avoid expanding into a full shopping shell. Keep existing API health behavior functional.
- Perspective overview with orbit/pan/zoom and reset; top-down orthographic view for editing. Do not let camera movement cross below the floor. Top-down disables orbit while retaining pan/zoom; its up vector must not be parallel to the view direction.
- First room uses floor and individually identified walls, with a simple cutaway for the overview; omit obstructing walls in top-down. Camera-dependent fading is a later polish step if needed.
- Selecting furniture highlights its footprint without changing cached shared materials. Clicking empty floor deselects.
- Pointer-down on a selected movable instance begins a drag; preserve the pointer-to-object offset to avoid a jump. Project movement onto the floor plane, then optionally snap in centimeter coordinates.
- Disable camera controls for the drag. Pointer-up commits one `setPose`; Escape/pointer cancellation/window blur restores the original pose with no history. Pointer capture and cleanup cover release outside the canvas, lost capture, removal, and component unmount. Ignore additional pointers/buttons during a drag. If the ray cannot intersect the floor reliably, preserve the last preview instead of applying an invalid pose.
- Disable geometry edits and undo/redo during an active drag, or cancel it explicitly before executing another edit; never allow concurrent pose owners.
- A supplied GLB replaces a dimensioned, labeled loading proxy inside the existing placement wrapper. Load completion never moves furniture, resurrects a deleted instance, or creates history. Isolate failures per model so a bad asset cannot blank the scene; provide a labeled proxy and retry.
- Duplicate GLBs have independent object hierarchies. Cache/share safe geometry and textures, but do not reparent one shared scene object across instances or dispose shared resources when deleting one copy.
- Keep keyboard shortcuts inactive while typing in form fields. Provide visible rotate/remove/undo/redo controls and numeric coordinates so basic edits do not depend entirely on dragging.
- Use restrained local lighting, one shadow-casting key light, sensible pixel ratio, and on-demand rendering with invalidation during interaction. Prefer local assets over runtime CDN dependencies for the demo.

## Parallel implementation ownership

Use one coordinator plus three implementation subagents after the shared contract is written. Each worker stays on this branch; no separate user tasks, branch switching, commits, or pushes. Read current files before edits. These are software-agent assignments, not assumptions about human teammate roles.

| Owner | Exclusive files / responsibility | Integration boundary |
| --- | --- | --- |
| Coordinator | Root `.env` setting, `.env.example`, dependency files/lockfile, Vite config, `scene/types.ts`, `units.ts`, `fixtures.ts`, `Scene.tsx`, `App.tsx`, shared styles, docs/index/TODO | Freeze types and exact component/hook signatures, compose the scene, own integration and verification |
| Agent A: room and camera | `scene/Room.tsx`, `Grid.tsx`, `SceneControls.tsx` | Canonical room + camera mode + interaction-active flag; camera must honor the interaction lock |
| Agent B: assets and presentation | `scene/Furniture.tsx`, `FurnitureModel.tsx`, model fallback/helper files | Product + render pose + selected state + pointer callbacks; no history, selection store, or app-shell edits |
| Agent C: edits and interaction | `scene/commands.ts`, `useSceneEditor.ts`, `useFurnitureDrag.ts`, focused state/interaction tests | Reducer/hook owns committed cm poses/history and transient drag lifecycle; returns callbacks/state for coordinator to connect |

Before dispatch, root fixes function/component signatures including drag preview ownership, commit/cancel callbacks, and camera lock. Workers may create minimal stubs only within their files and must report incomplete parts. No placeholder implementation is accepted as a finished milestone.

Workers send proposed shared-contract changes to the coordinator. The coordinator serializes INDEX.md and TODO_SIN.md updates using each agent's work-log report so parallel agents do not overwrite shared Markdown. Every created documentation file must be indexed before handoff. One owner edits dependency manifests and lockfiles.

## Fast build sequence

Timeboxes are checkpoints for agent-assisted work, not delivery guarantees. Target roughly 4–6 hours elapsed for an integrated, verified foundation with three workers; retain the earlier 7–10-hour allowance if incoming assets or integration need correction. Reassess against the first working browser slice rather than dividing old single-person estimates by agent count.

1. **Contract/setup checkpoint (target 15–30 min):** verify dependencies/setup, write shared types/conversions/fixtures, add only necessary helpers/test tooling, freeze signatures, then dispatch A/B/C.
2. **First integrated slice (target next 60–90 min):** empty room/grid/camera plus add/select/move a proxy. Integrate continuously as modules appear; do not wait for all agents to declare their entire assignment done.
3. **Asset and history checkpoint (target next 45–90 min):** rotate/remove/undo/redo, GLB loading/duplicate independence/failure fallback. Use a known test GLB if collaborator assets are not ready; report that real-asset validation remains pending.
4. **Quality/rehearsal checkpoint (reserve at least 45–60 min):** perform automated and browser checks, resolve serious failures, inspect composition at laptop size, and record actual performance. Continue only necessary fixes.

If behind, keep the usable slice and cut advanced wall fading, custom shaders, additional furniture variants, polished loading animations, and screenshot capture. Do not cut scale correctness, camera/drag cleanup, undo correctness, model failure isolation, or clear user controls. Stop adding features when the acceptance journey passes.

## Required quality gates

Automated checks target meaningful failures:

- Unit conversion and configuration: 600 × 500 × 280 cm at 5 and 10 cm/unit; invalid scale rejected; a 2 m GLB uses the correct wrapper scale; no double conversion.
- State: add/move/rotate/remove undo/redo, one drag equals one history entry, cancel/no-op leaves history unchanged, new edit clears redo, duplicate/unknown IDs and non-finite values leave state unchanged.
- `npm run build` passes. Run backend checks only if backend behavior changes; do not widen testing without a reason.
- All documentation files under `docs/` have direct working root INDEX.md links; changed local links and example JSON are checked. `git diff --check` passes.

Manual/integration checks use `./run-local.sh` (run `./setup.sh` first only if local setup is missing):

- Empty room → add two objects → select → move with snap on/off → rotate → numeric edit → undo/redo → remove → reset camera.
- Mouse and trackpad: orbit/pan/zoom, top-down transition, window resize, drag across canvas bounds, Escape, blur/cancel, and typing into numeric fields without triggering shortcuts.
- Two instances of one real GLB remain independent; an intentionally broken model URL leaves the room interactive with its proxy. A slow load preserves pose; retry works; removing a loading object does not resurrect it. One model unmount does not break another. Proxy-only checks cannot pass the GLB loader gate. Check the browser console for errors throughout this path.
- Test both 5 and 10 cm settings, confirming saved physical dimensions remain constant. Revert to 5 cm after verification.
- Inspect on the actual demo laptop at approximately 1366 × 768: viewport and primary controls visible, labels readable, objects sit on the floor, no grid flicker or major clipping, errors are understandable.
- Target at least 30 FPS while manipulating the small demo scene, aim for 60. Report device/browser/object count and how measured; do not infer performance from a successful build. Cold-load time is measured after actual asset sizes are known, not promised now.

Passing compilation alone does not establish interaction or visual correctness. Final report names completed gates, pending real-asset checks, and any remaining defects. No pretending a missing backend or asset integration has been verified.

## Handoff status

The rendering/interaction foundation is implemented. See [implementation and verification](editor-implementation.md) for the actual file map, commands, checks, limits, and collaborator integration path. Actual furniture assets and Mori font files remain pending; spatial validation and backend transport are deferred. This plan retains the original review and acceptance targets for context.
