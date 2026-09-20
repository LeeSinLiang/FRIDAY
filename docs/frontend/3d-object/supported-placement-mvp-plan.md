# Minimal supported placement with AI references

The full-building floor-test milestone is implemented locally; see [reproduction and verification](../room-capture/skyscraper-glb-test.md). Table/cabinet attachments and live AI integration remain planned. Originally prepared against source `13297be8c637f0669660a434282f20af1b3d2b97` on 2026-09-20. Owner: William. [Geometry research](supported-object-placement.md) explains the underlying support and containment rules.

## 1. Skyscraper workflow is the first acceptance test

- Open the **complete** `/Users/williamxu/Downloads/free-london-skyscraper/edited/London_Skyscraper_Unfurnished.glb` in the current PlayCanvas engine. Show an exterior overview proving the entire building loaded, then move the camera onto a selected interior level. Frame the camera and its clipping range from the building bounds without rescaling the model.
- Create a reproducible dedicated test scene at proposed path `shared/rooms/london-skyscraper-test/test-scene.json`, with a prepared-room manifest/spatial package and an explicit development route such as `/?room=london-skyscraper-test`. This is a proposed fixture and route, not an existing working endpoint. The current `?testAssets` route opens the legacy engine, so it does not satisfy this test.
- Establish reference scaling first: the GLB uses nominal metre coordinates, the application stores centimetres, and existing conversion is `100 / SCENE_UNIT_CM` (20 engine units per metre at the current default of 5 cm/unit). Reuse the existing `scale-reference` GLB, declared **200 × 100 × 100 cm**, and verify its actual geometry and rendered dimensions. This verifies unit consistency; it does not certify real-world dimensions of the authored skyscraper.
- Review a usable surface on candidate C01 at approximately Y=7.1749 m, display its accepted support boundary, and spawn the reference object there. Record the actual local floor origin/height; retain the original textured building as the visual. All collision boundaries must be checked against this model, not inferred from the building's bounding box or the candidate area's total size.
- Drag the object across that surface in first-person view. Valid positions stay at the measured support elevation. Crossing a boundary, gap or obstacle must visibly reject the placement and preserve the last accepted position on release. Do not let pointer rays silently switch to a floor above or below. Check rotation, full-footprint support, reload and undo.
- Replay on C17 (about 78.7850 m) and C32 (about 145.2312 m), after separately reviewing their surfaces, to check unequal spacing and changing footprints. One active level at a time is enough; the complete building asset remains loaded. Saved layouts and AI references must identify the active floor explicitly.
- Once that loop passes, run the lamp/table and object/open-cabinet cases **within this same skyscraper test scene**. Keep horizontal supports, upright objects, yaw rotation and one attachment level. Automatic general-purpose extraction and closed-door animation follow later.

## 2. Test file and reproducibility

The dedicated test file should reference, rather than duplicate, the prepared-room spatial data and shared furniture profiles. Record:

| Test data | Purpose |
| --- | --- |
| Source GLB path/runtime URL and SHA-256 | Prove the complete supplied asset is what the engine loads; preserve its bytes and textures. |
| Units, scale and model-to-floor transforms | A single explicit conversion chain, with no automatic fit-to-room scaling. |
| Reference object ID and expected dimensions | Compare numeric world bounds and the visible reference against the declared 200 × 100 × 100 cm fixture. |
| Candidate/accepted floor IDs, elevations and geometry revisions | Distinguish measured candidates from surfaces approved for dragging; never assume equal story height or slab thickness. |
| Support/obstacle data references, initial poses and cameras | Deterministic overview, interior and close-up views and reproducible object placement. |
| Drag checkpoints with expected outcomes | Interior success; edge/obstacle/gap rejection where present; rotation; return to valid support; floor switch; save/reload. |

Extend the existing prepared-room registration, editor ID selection and manifest asset allowlist for this specific fixture. Preserve path checks. Where floor contexts share the visual, use an explicitly declared building-owned asset reference rather than duplicating or silently granting arbitrary cross-package file access. The test scene definition seeds a dedicated test layout once or through an explicit test reset; reopening it must not overwrite saved user edits.

Review the existing LISABO table and low open bookshelf as later test furniture. Their tabletop/cubby geometry still needs inspection. Supply clearly labelled small lamp and box/book demo GLBs if suitable assets are absent. The existing HEKTAR is an unbound 181 cm floor lamp with a footprint mismatch, so it is unsuitable for the tabletop proof.

## 3. Shared placement contract

Add one versioned placement-profile JSON registry, readable by Django and the frontend, keyed by catalogue product ID and the model hash. Each enabled asset describes **support surfaces**, **empty compartments**, **solid collision boxes**, its **base contact footprint**, and the transform from GLB coordinates to the canonical centimetre frame. Begin with rectangles and upright boxes; verify profiles against the rendered assets.

Keep normal floor instances backward compatible. Add an optional attachment to an instance:

```text
attachment = {
  parentInstanceId,
  target: {kind: "surface" | "compartment", id},
  localPose: {xCm, zCm, yawRad},
  profileRevision
}
```

For attached objects this record is authoritative. Resolve a room-space `pose` including `yCm` from the parent, selected support and child's base offset; treat it as derived data. Legacy floor poses without `yCm` resolve to zero. Reject arbitrary unsupported heights, unknown targets, stale profiles, cross-room parents and nested attachments in this first version. A profile change requires revalidation rather than silently moving saved objects.

- **Lamp:** full base footprint fits on the top; body/shade avoids solid geometry; support contact is allowed.
- **Cabinet:** base fits on its shelf; the complete collision volume fits within the compartment and avoids panels, shelf above and other contents.
- **Collisions:** reuse X/Z oriented-box checks plus overlapping Y intervals for each solid proxy part. Keep checking parent solids; never suppress every collision with the supporting instance. Fixed obstacles without height metadata remain conservative blockers.

## 4. Implement in this order

| Step | Change in the current engine | Completion check |
| --- | --- | --- |
| 0. Full-building fixture and floor dragging | Register the entire GLB, dedicated test scene and scale reference; review one floor surface, use its explicit local frame and enable the current draggable-object workflow there. Add the active-floor selector and repeat with separately reviewed middle/upper surfaces. | Overview and interior show the supplied building; reference scale matches; valid/invalid drag behavior is correct on three unequal levels. |
| 1. Profiles and resolver | Add the small shared profile registry, demo assets and pure attachment-to-room-pose resolution. Extend `scene/types.ts`, product/snapshot parsers and backend validators. Server loads trusted profiles itself. | Measured tabletop/cubby/base metadata agrees with source geometry; existing floor snapshots still load. |
| 2. Authoritative placement | Extend `scene/placement.ts` and `backend/api/scene_service.py` with matching support, containment, height and compound-box checks. Extend existing `try_place` to accept an attachment and return the resolved pose plus structured rejection reasons. | Shared fixture cases agree in TypeScript and Python; unsupported placement cannot be committed through the API. |
| 3. Render and interaction | Extend `playcanvas/furniture.ts`, `interaction.ts`, region overlays and frozen captures to use resolved Y. Add a small “Place on / Place inside” target selector using the profile labels, surface-local snapping and valid-region preview. Keep logical attachments resolved into the existing flat visual entity ownership. | Both cases work through the current editor and capture pipeline. Missing profiles show unavailable targets. |
| 4. Save, move and undo | Resolve and validate a parent's attached children together in one transaction. Moving/rotating a parent preserves local child poses. Initially refuse deleting a parent with children until children are relocated/removed. Update restore ordering or use an atomic restore so undo never leaves an unsupported intermediate state. | Parent movement, rejection rollback, reload, retry and undo/redo preserve relationships and cart item identities. |
| 5. AI references | Supply current session-scoped scene references to the existing compiler; add target reference types and `inside` consistently across Python/TypeScript schema, prompt, parser, chips and region dispatch. Expose the same context/placement contract through existing agent adapters. | Two real prompts identify the correct target, produce a valid preview and use the same validation/confirmation path as manual placement. |

Existing `ALLOW_STACKING=false` stays in place until steps 1–4 are complete. Replace its dormant center-only/ignore-parent behavior with the new support rule when enabling it. Keep floor placements on the existing path; use the chosen support frame for elevated region masks.

Before implementation edits, coordinate shared pose/scene signatures with the scene owner and compiler/tool signatures with Saketh's agent/DSL lane. Existing scene-context work is recorded under the Saketh-owned Blender MCP-style card; this plan should extend that contract rather than create a competing harness.

## 5. What the AI receives and returns

Add or extend a read-only `get_scene_context` adapter. It returns current room/scene/profile revisions, instance IDs, labels, resolved poses and **only available** support/compartment targets. Session identity comes from the trusted request; the model cannot supply it. Illustrative target references:

```json
[
  {"kind":"surface","instanceId":"table-1","id":"top","label":"Tabletop"},
  {"kind":"compartment","instanceId":"cabinet-1","id":"upper-left","label":"Upper-left cubby"}
]
```

These are proposed example IDs; actual IDs must come from live context. Keep labels human-readable and IDs stable. Include building/floor identity, the accepted floor support ID, usable dimensions, clearance and unit/frame information so the AI can choose a plausible target without inspecting raw GLB bytes. A floor reference must include its room/floor identity (for example `london-c01 / floor-main`); changing floors invalidates pending proposals from the previous context.

Use the existing compiler's `on` clause with a surface reference; add `inside` with a compartment reference. The two acceptance prompts are “put this lamp on the table” and “put this object in the cabinet's upper-left cubby.” Replace `MOCK_ROOM` with the originating session's scene references, and return the scene revision used during compilation. Resolve ambiguous/missing targets explicitly; do not invent a target or silently drop the requested relationship.

Flow: **current context → target reference → `try_place(dry_run=True)` → valid preview → existing confirmation/save → revision-bound capture**. An optional local X/Z/yaw is in the target's frame. The engine derives height; the model does not choose it. Omitted coordinates use a bounded search for a valid local placement. Return specific failures such as `unsupported_target`, `support_overhang`, `outside_compartment`, `collision` or `stale_context` so the caller can explain or revise the proposal.

Extend SDK-independent adapters in `backend/api/engine_tools.py`; use the existing compiler/UI flow for the minimal end-to-end demo. Those adapters alone do not make the current one-turn compiler an autonomous tool-calling agent. The existing screenshot tools remain available to the separate agent harness, using actual image content when a model needs to see the result.

## 6. Acceptance and handoff

- First complete the full-building overview → scale reference → selected floor → drag/reject → save/reload loop from sections 1–2, and repeat on the reviewed lower/middle/upper levels. Record numerical contact heights and dimensions alongside screenshots. Then test lamp center/edge/base support, shade collision, compartment width/depth/headroom, two items sharing a shelf, separate shelf heights, unknown/stale target references, unsupported Y, parent move/rotate, deletion policy and legacy floor snapshots. Pair frontend/backend fixtures rather than duplicating implementation logic in tests.
- Run the repository's full backend suite without labels, `npm test` and `npm run build`; register new frontend tests in the canonical runner. Record actual counts and output. Historical research baseline results do not verify these changes.
- Launch the canonical stack on available dedicated ports, e.g. `BACKEND_PORT=8234 FRONTEND_PORT=5234 ./run-local.sh`. Exercise the dedicated skyscraper route and full-building workflow first, then both natural-language proposals in that building, confirmation, reload and undo. Capture front/side views and a rejected placement. Use the existing image-capture tools to verify the agent-facing result matches the accepted revision.
- Verify the serving checkout, source commit, source model hash and profile revision; refresh the exact running artifact used for the test. Inspect for stale copies and stop every test process afterward. Keep screenshots under `.scratch/`. If model credentials are unavailable, mark the live-AI acceptance step incomplete while reporting deterministic adapter results separately.
- Update William's TODO, the existing support-placement task and relevant API docs after implementation. The floor-test implementation and its screenshots are documented separately above; the attachment and live-AI milestones remain incomplete.
