# Region solver: where an item may go

2026-09-19 · Saketh · Implemented in `frontend/src/region/`. Pure TypeScript: no React, no renderer.

Given a scene, a candidate product and the `place[]` clauses of a compiled `Program`, the solver returns, for each quarter turn, a mask of every floor position where the item's **centre** may go. Lighting that mask on the floor is the product's core interaction.

```ts
import { solve } from "../region/solve";
const { masks, dropped, legalCounts, bestYawIndex } = solve(scene, { product }, program.place);
```

- `masks[i]` is for `YAW_BINS[i]`: 0, 90, 180, 270 degrees.
- `dropped[]` lists clauses that could not be honoured, each with a reason. **Show them.** Discarding a shopper's words silently is a bug.
- `bestYawIndex` is the rotation with the most legal centres, `-1` when nothing fits at any rotation.
- **"Nothing fits" is an answer, not an error**, and the one a store that has to sell you something cannot give. When it happens, `whyNothingFits` names the binding constraint in plain words: `needs 373 cm of depth, this room has 360 cm`; `it is 300 cm tall and the ceiling is 280 cm`; `there is no free floor big enough for its 70 × 80 cm footprint`; or, when requests contradict each other, `these can't all hold here; without “152 cm away from any wall” it fits`. The last form costs one extra solve per clause, and only on failure.
- `nearestLegal(mask, pose)` gives the closest legal centre, for snapping a drop.
- A mask takes 4–12 ms for a 600 × 500 cm room.

## The mask is `floor-grid-v1`

Exactly the spatial artifact in the [room-capture plan](room-capture/research-and-integration-plan.md): `uint8`, x-fastest, states `unknown 0 / free 1 / blocked 2`, plus `yawRad`. The same format is accepted as `scene.occupancy` for static obstacles and unobserved floor in a reconstructed room.

- **Only `free` is lit.** `unknown` is never lit, and floor outside the occupancy grid counts as unknown: no data is not free space.
- **`CELL_CM = 5`, fixed.** It is not derived from `SCENE_UNIT_CM`, which only changes draw scale and must never change whether a chair fits.
- **Sampled at grid points, not cell centres** (x = 0, 5, 10 … including both walls, so a 600 cm room has 121 samples across). Every pose the editor's 5 cm drag snap produces is then exactly one sample, and the lit floor cannot sit half a cell from where a drop is accepted. If `SCENE_UNIT_CM` is set above 5, drag snap is coarser than the mask; nothing breaks, some lit points are simply unreachable by snapping.

## Invariants are not reimplemented

Inside the room, not too tall, not overlapping anything: `invariants.ts` asks the editor's own `validatePlacement` for every grid point. The solver and the drop check therefore cannot disagree. Property tests assert it in both directions over random scenes, and that every point lit under random clauses is accepted by the editor.

When the room has door openings, a door's swing is also always kept free. It is never a clause.

## Clauses

Distances are measured from the item's **edge**, not its centre.

| Clause | Rule | `any_wall` / unnamed opening |
| --- | --- | --- |
| `distance_min(ref, mm)` | gap to ref ≥ distance | EVERY target |
| `clear(ref, mm)` | walls and items: as `distance_min`. Door or window: keep that depth in front of it free | EVERY |
| `not_blocking(ref)` | door: stay out of its swing. Window: items taller than the assumed sill stay out of the zone in front. Item: leave room to walk up | EVERY |
| `near(ref, mm?)` | gap to ref ≤ distance. Unstated: `NEAR_DEFAULT_CM` **beyond whatever clearance the target's own wall demands** (see below) | SOME one |
| `against(ref)` | gap ≤ `AGAINST_TOLERANCE_CM` **and the item's back faces the wall**, so it fixes the rotation | SOME one |
| `on(ref)` | wall: same as `against`. Item: **dropped**, see below | SOME one |

The every/some split is the same one `compile()` follows; see [the catalogue doc](../backend/catalogue.md).

### `near` has two readings, on purpose

This looks like a bug when you first read `clauses.ts`. It is not.

| The shopper said | Reading | Reach |
| --- | --- | --- |
| "by the window" (no distance) | **As near as the other requests allow** | `NEAR_DEFAULT_CM` measured from where the target's own wall lets the item stand: `NEAR_DEFAULT_CM + that wall's required clearance` |
| "within 2 feet of the window" (a distance) | **Literal** | exactly that distance |

Why: a window or door is *on* a wall. "A reading chair by the window, 5 feet from any wall" asks for within 75 cm of something mounted on a wall the chair must stay 152 cm from. With one fixed reach that sentence is unsatisfiable in every room ever built, though any person would place the chair happily: 5 feet out, in front of the window. So an unstated `near` starts counting from the clearance its own wall demands (`wallClearances()` collects those from `distance_min` and `clear` clauses naming that wall or `any_wall`).

A stated distance is a number the shopper chose, so it is honoured exactly. "Within 75 cm of the window, 5 feet from any wall" is a genuine contradiction and is reported as one: `these can't all hold here; without “152 cm away from any wall” it fits`.

Targets that are not on a wall (a placed item) have no wall clearance to add, so both readings coincide for them.

Tunables in `clauses.ts`, all judgement calls to adjust at rehearsal: `NEAR_DEFAULT_CM = 75`, `AGAINST_TOLERANCE_CM = 5`, `WINDOW_ZONE_CM = 50`, `APPROACH_CM = 60`, and `WINDOW_SILL_CM = 90`, which is an **assumption**: the room carries no sill height.

### What gets dropped, and why

- A window or door when the room has no `openings` (only the Cg Arch living room is measured so far), or no opening with that id.
- A wall or item id the room does not have.
- `not_blocking` a wall.
- **`on(item)`.** The editor rejects an item overlapping its support, so a lit table top would be refused on drop, which is worse than no region. The rule is implemented behind `ALLOW_STACKING = false` in `clauses.ts`; it is one line to enable if stacking lands.

## Units: one crossing

The catalogue and the DSL are integer millimetres; the scene is centimetres. Neither changes. `boundary.ts` is the only place they meet: `mmToCm`, `placeToCm`, `listingToProduct`, and the wall mapping. Nothing else divides by ten.

**What a wall is.** A wall is a solid piece of the boundary of the floor an item may stand on, and a room has as many as its shape gives it (`floor.ts`). The floor is the room itself for a fixture room and the reviewed free areas for a prepared one, **not the modelled shell**: measured to the 1158 × 844 cm shell, "5 feet from any wall" in the Cg Arch living room used to pass for the wrong reason. The floor is rasterised onto a *compressed* grid whose lines are exactly the edges that occur in the room, so a wall at x = 787 is at 787 and not at the nearest 5 cm; every cell side where floor meets not-floor is a boundary edge, facing the way a wall on that side would. Nothing assumes a rectangle:

- An L-shaped floor has six walls, two facing south and two facing east, and "the east wall" (`w-e`) means both. The inner corner is a wall like any other, and distance to it is Euclidean.
- `distance_min(any_wall, d)` is the distance from the item's footprint to the nearest wall piece. It is exact, not a 5 cm raster: on the demo room the raster would have moved the walls by up to 3 cm and changed the answer.
- A pillar or an island counts as a wall when it is **cut out of the free areas**, which is how the Haussmann room records its partitions. Fixed **obstacles do not count**: in the rooms we have they are scanned furniture, and "four feet from any wall" must not mean four feet from a coffee table that came with the capture. They still block placement. Nothing in an obstacle says whether it is architecture, and reading its label would be a heuristic.
- `against(wall)` needs the item's back to run along the wall for at least half the item's length. A wall is a segment now, so merely touching its end point is not being against it; on a rectangular floor a wall spans the whole side and this is always true.
- "Needs N cm of width, this room has M" compares against the longest unbroken run of floor each way: the room's width for a rectangle, the most generous honest reading for anything else.

**Portals: boundary that is not a wall.** A doorway is not a wall, and neither is the open side of a living area that runs on into the next space; the thing behind your sofa is. A portal is an axis-aligned segment in scene centimetres, `{ id, from: [x, z], to: [x, z], leadsTo? }`, authored per room in `shared/rooms/<room>/openings.json` beside the openings (and, like them, deliberately *not* in `manifest.json` or `spatial.json`, which the room importer compares byte for byte). It only relabels the boundary pieces it covers: it adds and removes no floor, so placement is untouched. `any_wall` and the named walls measure only to solid pieces; the end of a wall beside a portal is rounded, because distance to a segment's tip is Euclidean; a side that is all portal has no wall to be `against`, and the clause is set aside with that reason. When a room has any portal, "needs N cm of width" is not offered, since beside an opening "item plus both clearances" would be a false sentence, and the general explanation is used instead. A portal drawn through open floor changes no wall: it is a threshold between rooms, which the component model will use.

**The demo room applies no portal, on purpose.** Measured from the model, the partition on its west side ends at z = 420, and from there to z = 760 the x = 787 edge is open into the adjoining space. Applying that would leave the full hero sentence untouched (60 / 75 / 60 / 75: its patch lies beside the solid stretch) but would move "4 feet from any wall" from 220 / 265 to 496 / 519 and make "5 feet from any wall" *fit* (3 / 6 / 3 / 6), ending the "needs 371 cm of width, this room has 334 cm" beat. The entry is written out in the room's `openings.json` under `portalsNote`, and `floor.test.ts` pins both worlds, so switching it on is one line and an informed decision.

On rectangular floors all of this equals plain rectangle arithmetic, which a property test checks at every grid point for every clause kind that mentions a wall (over a million points). `wallBounds()` survives only as the box around the floor, used to address an opening along a compass side and to describe the floor's size in words.

**Walls.** The scene's `Room` has no named walls; the DSL says `w-n`, `w-e`, `w-s`, `w-w`. Mapping: north is z = 0 (the editor's back wall), east is x = `widthCm`, south is z = `depthCm`, west is x = 0 (its side wall). Compass words, because "left" means nothing in first person.

**Catalogue → scene.** `instanceFromListing` builds a placeable instance that carries its product; the scene accepts it and the server checks it against its own catalogue (see [scene API](../backend/contracts/scene-api.md#catalogue-products-added-by-sakeths-lane-2026-09-19)). `listingToProduct` converts `dims_mm / 10` and folds the 12 categories onto the scene's 3 `kind`s, which only pick a stand-in shape: sofa, bed → `sofa`; armchair, chair, lamp, plant → `chair`; table, desk, shelf, storage, rug, decor → `table`.

## Openings: where a room's windows and doors are

`near(window)`, `not_blocking(window)` and `clear(door)` bind to `scene.openings`. A room nobody has measured has none, and those clauses are then set aside with a reason while everything else still solves.

```ts
type Opening = {
  id: string; kind: "door" | "window";
  wall: "n" | "e" | "s" | "w";
  startCm: number;   // along the wall FROM THAT WALL'S OWN LOW CORNER (wallBounds): +X for n and s, +Z for e and w
  widthCm: number;
  swingCm?: number;  // doors; defaults to widthCm
  sillCm?: number;   // windows: measured sill height. Absent means unmeasured, and 90 cm is assumed
  headCm?: number;   // recorded, not used by the solver
};
```

`startCm` is **wall-relative, not a scene coordinate**. An opening belongs to a wall and moves with it; in a prepared room the walls are the edges of the free floor, so the same window has a different scene x than its `startCm`. `openingZone()` is the one place that converts, and the SVG debug view draws through it.

**The Cg Arch living room has one window, `w1`**, on the north wall: `startCm` 19.5, `widthCm` 280, sill 7.5 cm, head 212.5 cm (floor-to-ceiling glazing). It was measured from the room's own model, node `Room Glass Windows`, world bounds x 8.065 to 10.865 m, which has no rotation or scale of its own under a manifest that places the model untransformed. `python3 scripts/room_openings.py shared/rooms/cg-arch-interior` prints the measurement again, and `backend/api/test_room_openings.py` holds the file to the model wherever the licensed GLB is imported. The model's three glass doors open onto floor outside the free rectangle, so they are not listed. The id is `w1` because that is what the compiler's room stub calls "the window", on the same north wall, so "by the window" resolves with no compiler change.

**Where the data lives, and why not in the manifest.** `shared/rooms/<room>/openings.json`, looked up by `frontend/src/region/roomOpenings.ts` and passed to `useRegion` by the editor's catalogue layer. It is deliberately *not* a field of `manifest.json` or `spatial.json`: `scripts/import-room.sh` refuses to install a room whose tracked metadata differs by one byte from the bundle it was packed with, so adding a field there would break the room import for the whole team. A test fails if openings ever appear in either file. Moving them into the scene's `Room` (served by the API, validated in `useRoomSession`) remains the proposal for after the demo; it is Sin's contract to change, and needs a re-packed bundle.

**A measured sill replaces the assumed one.** `not_blocking(window)` lets anything up to the sill stand in front of a window. With no measurement that is 90 cm; this room's glazing starts 7.5 cm off the floor, so there a chair does block it.

**The hero sentence, whole, in the real room:** "by the window, 4 feet from any wall" leaves HERRÅKRA 60 / 75 / 60 / 75 positions per turn (220 / 265 without the window clause; 240 / 255 at 3 feet; none at 5 feet: "needs 371 cm of width, this room has 334 cm"). Derived by hand in `rooms.test.ts` and matched by the solver: 121.9 cm off every wall leaves 4 columns unturned and 5 turned, and `near` reaches 75 cm past the window wall's own clearance, which leaves 15 rows.

## In the app: hover, pick up, place

`frontend/src/catalogue/CatalogueShelf.tsx` is a docked, non-modal panel in the editor. A sentence goes to `POST /api/compile`; its `find[]` searches `GET /api/search`; its `place[]` narrows the region. Hovering a result solves for it (`useRegion`: 90 ms debounce, a result is discarded if the pointer has moved on) and lights the floor. Clicking a result picks it up; clicking lit floor places it through `instanceFromListing` and the editor's normal edit path, so it is validated and saved like any other item. **R** turns it through the rotations that fit; **Esc** puts it down. The panel says that it fits, or that it won't and why, and lists clauses it could not use. `?dev=1` adds the raw per-rotation sample counts, which mean nothing to a shopper.

**A click on green always places.** The mask is drawn with nearest filtering, one texel per sample, so the lit area *is* the set of pixels that round to a lit sample. A click is snapped to that sample rather than placed at the raw raycast point: the mask is the set of poses that were proven, so an item is only ever placed at one of them. The editor's snap-to-grid toggle therefore has no effect on whether a placement succeeds. Clicks outside the lit region do nothing, quietly. As a last guard the app re-asks `validatePlacement` before adding and logs an error if it ever disagrees, since that would be a solver bug.

### The renderer lives in one file

`frontend/src/region/FloorOverlay.tsx` is the only file in the region module that imports three.js or React Three Fiber; a test fails if another one does. Its whole interface is **a mask in, a pose out**: `{ mask, armed, onPlace(pose) }`. It needs three things from whatever renderer hosts it:

1. **A floor plane in scene coordinates** with a known origin and axes. Today: origin at a floor corner, +X width, +Z depth, `cmToScene` for scale; the quad overhangs the first and last sample by half a cell so texel centres sit on grid points.
2. **A single-channel texture it can upload and sample in the floor material.** Today: `mask.data` as an `R8` `DataTexture`, nearest filtering, `unpackAlignment = 1` (rows of 121 bytes are not a multiple of four), sampled by a ~20-line shader that lights `free`, discards everything else, and fades its dot pattern with `fwidth` so it does not crawl at eye level.
3. **A raycast from the pointer to a floor coordinate in cm.** Today: R3F's pointer events on the quad give `event.point`.

Porting to PlayCanvas means rewriting this one file against those three points: a `pc.Texture` with `PIXELFORMAT_R8` and nearest filtering, a small shader or material chunk on a floor plane entity, and a camera `screenToWorld` ray intersected with the floor plane. Estimate: **2–3 hours** including the eye-level check, assuming the splat room keeps the floor at y = 0 in the same cm-derived coordinates. Nothing else in `frontend/src/region/` or `frontend/src/catalogue/` changes.

One thing worth knowing before porting: three.js clones a `ShaderMaterial`'s uniforms, so they must be written through the live material, not the object passed in. The first version here wrote to the original object; the count changed when the item was turned and the drawn region did not.

### Rooms

`shared/scene-fixtures.json` has an additive `rooms` map of presets beside the default `room`. `?room=studio` selects the **Studio**, 260 × 200 cm with a table and a chair already placed, and the panel switches rooms in one click (a reload: the room is a constant for the life of the page). It exists so "this won't fit, and here is why" can be shown rather than described: in the 600 × 500 cm living room almost everything fits. See the [scene API](../backend/contracts/scene-api.md) for how the server keeps a layout per room.

## Debug view

`toSvg(scene, mask)` returns an SVG string: room, openings, placed items, lit region (green), unobserved floor (amber). `npm --prefix frontend run region:debug [outDir]` writes examples. The dev page at `/dev-search.html` solves the compiled sentence in the editor's 600 × 500 cm fixture room (with stub openings and two placed items, so the ids `compile()` emits resolve) and shows the floor, the legal count per rotation, and dropped clauses in red.

## Files

| Path | Purpose |
| --- | --- |
| `types.ts` | `FloorGrid`, `Mask`, `Opening`, `Scene`, `CELL_CM`, `YAW_BINS` |
| `boundary.ts` | The only unit crossing; listing adapter; wall mapping |
| `grid.ts` | Mask construction, `intersect`, `union`, `nearestLegal` |
| `invariants.ts` | Invariant mask via `validatePlacement`, plus occupancy |
| `occupancy.ts` | `floor-grid-v1` input, summed-area footprint tests |
| `geometry.ts`, `clauses.ts` | Rect helpers; one rule per clause; tunables; `dropped` reasons |
| `solve.ts`, `explain.ts` | Entry point; why nothing fits |
| `FloorOverlay.tsx` | The only renderer-specific file: draws a mask, reports a placed pose |
| `useRegion.ts` | Debounced hover → solve, stale results dropped |
| `svg.ts`, `debugScenes.ts`, `devScene.ts` | Debug view, debug script scenes, dev-page stub room |
| `rng.ts`, `region.test.ts`, `clauses.test.ts` | Seeded generator and tests; run by `npm test` through `scene/all-tests.ts` |
