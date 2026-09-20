# Lamp-on-table and object-in-cabinet placement

Research and proposed design only, 2026-09-20. Based on the current source snapshot `13297be8c637f0669660a434282f20af1b3d2b97`; no application changes, model edits, dependency changes or runtime experiments were made for this follow-up. Exact table, lamp and cabinet assets have not been selected or geometrically reviewed.

## Recommended first implementation

Add reviewed **support surfaces** and **interior compartments** to furniture metadata, then extend the current deterministic placement validator to use height and parent relationships. Keep the original textured GLBs. Begin with one horizontal tabletop and one open cabinet shelf, upright objects and yaw rotation.

A support surface tells us where an object's base can rest. A compartment adds the empty volume in which the entire object must fit. Thus a book in a cabinet has both a shelf supporting it and a compartment containing it. These relationships also apply to floors and building levels later.

This follows the receptacle approach used by Habitat: its [metadata taxonomy](https://aihabitat.org/docs/habitat-lab/metadata-taxonomy.html) describes annotated placement regions relative to parent objects; its [ObjectSampler](https://aihabitat.org/docs/habitat-lab/habitat.datasets.rearrange.samplers.object_sampler.ObjectSampler.html) attempts placements on those regions. Habitat's [AnyObjectReceptacle](https://aihabitat.org/docs/habitat-lab/habitat.datasets.rearrange.samplers.receptacle.AnyObjectReceptacle.html) explicitly documents that an outer-bounding-box heuristic does not handle interior cabinet shelves. These are design references, not dependencies to add to FRIDAY.

## Lamp on a table

1. **Describe the tabletop.** Store an ID, local height and usable polygon in the table's canonical object frame. For the first model a rectangle is sufficient. Measure the actual top surface; the whole model's maximum height could belong to trim or another part.
2. **Describe the lamp base.** Store the support/contact footprint and its vertical offset from the lamp's origin. Use a separate collision proxy for the lamp body and shade. A shade can extend past the base; its width is not automatically the area that needs support.
3. **Target the surface.** Let the user select the tabletop or choose it from a surface list. Intersect the pointer ray with that surface's plane in table-local coordinates, and constrain the entire transformed lamp base to the usable polygon. Merely testing the base center permits edge overhang and is insufficient.
4. **Snap the height.** For upright objects with horizontal support, `lamp origin Y = tabletop Y - lamp base local Y`. In an illustrative 75 cm table with a floor-centered lamp pivot, the lamp origin is 75 cm. The production implementation must use the actual asset's pivot/transform, not assume it.
5. **Validate solid geometry.** Permit contact with the tabletop within a small numerical tolerance; reject penetration into the tabletop, nearby objects, walls, ceiling or the table's other solid parts. Keep contact tolerance separate from any display offset.
6. **Persist the relationship.** Store the lamp's local placement relative to that table and surface. Moving or rotating the table carries the lamp. Validate the entire moved assembly against the room and other objects before committing.

For a rectangular 120 × 60 cm usable top and a rectangular 20 × 20 cm base at zero relative yaw, the legal base-center region is 100 × 40 cm before an optional edge margin. This is an illustrative containment calculation, not a measurement of a catalogue asset. For concave tops or holes, polygon coverage must preserve the missing regions.

## Object inside a cabinet

1. **Describe one compartment.** Store its empty interior bounds, the shelf's support polygon/height, and a local opening. Keep these separate from the cabinet's exterior bounds.
2. **Describe the cabinet's solids.** Use local boxes for the side panels, back, top, bottom, shelves and, when present, door panels. One solid outer box incorrectly fills the cavity. One convex hull also bridges concavities.
3. **Choose a shelf and pose.** An explicit compartment selector avoids selecting the cabinet front instead of a shelf behind it. Snap the object's base to the shelf, using the same support rule as the lamp.
4. **Check containment and collisions.** Transform the object's conservative collision bounds into the compartment frame. For an axis-aligned rectangular compartment, all corners of each oriented collision box must lie inside the allowed volume with clearance. Also test against the cabinet panels, shelf underside above, door and existing contents. Concave compartments require a more appropriate decomposition; corner tests alone are not a general mesh-containment algorithm.
5. **Define access behavior.** First support open shelves. Fitting in the final compartment does not prove the object can pass through its opening. Before claiming physical insertion, check opening dimensions and a swept insertion path. Closed/animated doors need an explicit state and door clearance; they should not silently become nonblocking.
6. **Preserve attachment.** Moving the cabinet carries the contents and validates the resulting assembly. Disallow removing a support with attached children until they are relocated, or offer an explicit remove-assembly action. Avoid silently floating or deleting contents.

PlayCanvas documents [compound collision shapes](https://developer.playcanvas.com/user-manual/physics/collision-shapes/) assembled from simpler pieces. This is a useful representation for hollow furniture. FRIDAY can initially run equivalent geometric box checks in TypeScript and Python; adding a dynamic physics simulation is not necessary for deterministic design placement.

## Data and transform contract

Use a trusted per-asset placement profile, keyed by product/asset ID, asset hash and profile revision. A sidecar JSON file is the simplest initial format because it preserves the GLB byte-for-byte and is directly readable by Django. It should contain:

| Field | Purpose |
| --- | --- |
| `supportSurfaces` | Local horizontal height, polygon, holes and stable surface ID |
| `compartments` | Empty local volume, supporting surface ID, opening/access metadata |
| `collisionParts` | Conservative boxes or convex pieces representing actual solids |
| `contactFootprint` | Base contact shape and origin offset for the item being placed |
| `assetToCanonical` | Explicit transform linking rendered geometry and centimetre metadata |
| `profileRevision` / asset hash | Prevent stale geometry metadata from validating changed models |

For the first contract, choose one authoritative representation:

- Existing floor instances keep their room-local `pose`; absent `yCm` means zero when reading legacy data.
- Attached instances use a discriminated placement record containing `parentInstanceId`, `surfaceId`, optional `compartmentId`, and local X/Z/yaw. Their vertical position is derived from the trusted support surface and child contact offset.
- Resolve a world/room pose `{xCm,yCm,zCm,yawRad}` for rendering, collision and snapshots. Do not persist a second independently editable world pose for attached items.
- The attachment graph must be acyclic, refer to existing instances in the same room, and use known profile/surface IDs. Bound attachment depth and refuse stale profile revisions.
- Normalize profiles and GLB geometry consistently before validation. Nonuniform scaling, pitch and roll need additional support checks; keep them out of the first version.

Compose transforms as `worldFromChild = worldFromParent × parentFromChild`. The installed PlayCanvas 2.22.2 graph-node source supports parent/local transforms; its [GraphNode documentation](https://api.playcanvas.com/engine/classes/GraphNode.html) describes this hierarchy. Avoid parenting under the GLB's metre-conversion wrapper and accidentally applying unit conversion twice. Keep logical attachment separate from visual ownership initially: compute room-space poses and retain the existing flat furniture entity lifetime management. This also avoids deleting a child entity accidentally when rebuilding a parent visual.

The backend must load support and collision profiles itself. Client-carried metadata or the model's suggested heights must not bypass authoritative geometry checks.

## Collision and picking changes

Use outer bounds only as a fast broad-phase rejection. For upright boxes, a collision requires both X/Z oriented-box overlap and overlap of the Y intervals. Apply this to each pair of solid proxy parts; allow touching at the designated support plane without allowing interpenetration elsewhere. Never ignore every collision with a parent just because it is the named support.

Ray intersections choose a target and propose placement; they do not prove full support or clearance. For the initial annotated planes and boxes, the current custom ray/box math can be extended. PlayCanvas's [entity picking reference](https://developer.playcanvas.com/tutorials/entity-picking/) shows collision-based picking, but its rigidbody raycasts require collision setup; loading a GLB alone does not create that setup.

For future automatic surface discovery, use upward face clusters and raycasts to propose surfaces, followed by review. Open3D notes that signed-distance/occupancy inside tests require [watertight meshes with well-defined interiors](https://www.open3d.org/docs/release/tutorial/geometry/distance_queries.html). A cabinet's usable cavity must be represented as empty space; an undifferentiated whole-mesh inside test is not a dependable furniture compartment detector.

## Changes required in this codebase

| Files / systems | Required work |
| --- | --- |
| `frontend/src/scene/types.ts`, `products.ts`, `useRoomSession.ts`; backend product/instance validation | Add/version placement records and trusted profile references; migrate old floor instances; reject malformed parent relationships. |
| `frontend/src/scene/playcanvas/furniture.ts` | Resolve/render elevated poses and propagate parent movement. Current `applyFurniturePose` hardcodes Y=0. |
| `frontend/src/scene/playcanvas/interaction.ts`, overlays and captures | Pick elevated objects/surfaces, choose compartments and show surface-local placement previews. Current hit test assumes object bottom Y=0. Captures must resolve attachments from the frozen snapshot. |
| `frontend/src/scene/placement.ts`, `backend/api/scene_service.py` | Shared semantics for support coverage, height, compound solids, interior containment and assembly validation. Current overlap uses only X/Z footprints. |
| `frontend/src/region/clauses.ts`, region grid/solver | Enable `on(instance)` only once all layers support it. Existing `ALLOW_STACKING=false` is deliberate; the dormant rule checks only center containment and ignores the support instance, so it cannot be used unchanged. Generate masks in the selected support's frame. |
| Scene command and undo/redo pipeline | Add transactional attach/detach/move-assembly behavior. Current commands validate after each individual edit; parent and child changes must be resolved as one coherent assembly operation. Restore parents before children and remove children before parents, or introduce an atomic snapshot-restore path. Preserve cart identities and existing revision/idempotency rules. |
| `backend/catalogue/dsl/schema.py`, prompt and mirrored frontend schema | Existing DSL has `on`, but no `inside` or compartment reference. Add explicit compartment targeting and actual selected-scene refs; the current compiler still uses a mock room. |

The model can choose a known surface or compartment and suggest X/Z/yaw. The deterministic tool calculates height, checks support/fit and returns an accepted pose or a specific rejection. For example: `place_on(lamp, table, tabletop)` and `place_inside(book, cabinet, shelf_2)` are proposed tool intents, not existing callable tools.

## Acceptance sequence

1. **Lamp/table:** a center placement succeeds; full-base edge overhang fails; shade/body collisions fail; rotate/move table and verify the lamp follows; refresh and undo/redo preserve attachment.
2. **Open cabinet:** fitting object succeeds on the correct shelf; excessive width/depth/height, panel penetration and overlap with another item fail; same X/Z on two different shelves can succeed when their volumes do not intersect.
3. **Consistency:** identical fixtures produce matching TypeScript and Django decisions; support deletion, cycles, stale profiles, cross-room references and client-supplied height bypasses are rejected.
4. **Evidence:** source-textured front and side screenshots, an optional collision-overlay screenshot, persistence reload, and a rejected-placement example for each asset. Verify contact height and geometry numerically as well as visually.
5. **Later:** interior opening/path checks, door articulation, irregular surfaces, arbitrary imported models and whole-building orchestration.

Updated execution order: the linked implementation plan first loads the complete skyscraper into a reproducible scale-and-drag test scene, then runs the table/lamp and open cabinet/object checks inside that building. Generic automatic metadata extraction is a separate, larger task. This note establishes the approach; none of these new behaviors has been implemented or tested yet.

Implementation sequence: [minimal engine and AI reference plan](supported-placement-mvp-plan.md).
