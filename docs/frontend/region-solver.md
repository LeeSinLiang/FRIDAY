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

- A window or door when the room has no `openings`, or no opening with that id.
- A wall or item id the room does not have.
- `not_blocking` a wall.
- **`on(item)`.** The editor rejects an item overlapping its support, so a lit table top would be refused on drop, which is worse than no region. The rule is implemented behind `ALLOW_STACKING = false` in `clauses.ts`; it is one line to enable if stacking lands.

## Units: one crossing

The catalogue and the DSL are integer millimetres; the scene is centimetres. Neither changes. `boundary.ts` is the only place they meet: `mmToCm`, `placeToCm`, `listingToProduct`, and the wall mapping. Nothing else divides by ten.

**Walls.** The scene's `Room` has no named walls; the DSL says `w-n`, `w-e`, `w-s`, `w-w`. Mapping: north is z = 0 (the editor's back wall), east is x = `widthCm`, south is z = `depthCm`, west is x = 0 (its side wall). Compass words, because "left" means nothing in first person.

**Catalogue → scene.** `instanceFromListing` builds a placeable instance that carries its product; the scene accepts it and the server checks it against its own catalogue (see [scene API](../backend/contracts/scene-api.md#catalogue-products-added-by-sakeths-lane-2026-09-19)). `listingToProduct` converts `dims_mm / 10` and folds the 12 categories onto the scene's 3 `kind`s, which only pick a stand-in shape: sofa, bed → `sofa`; armchair, chair, lamp, plant → `chair`; table, desk, shelf, storage, rug, decor → `table`.

## Proposed: `Room.openings`

`near(window)` and `clear(door)` have nothing to bind to until the room describes its openings. Proposed optional, additive field, already accepted by the solver as `scene.openings`:

```ts
type Opening = {
  id: string; kind: "door" | "window";
  wall: "n" | "e" | "s" | "w";
  startCm: number;   // along the wall: +X for n and s, +Z for e and w
  widthCm: number;
  swingCm?: number;  // doors; defaults to widthCm
};
```

Without it those clauses are dropped with a reason and everything else still solves.

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
| `svg.ts`, `debugScenes.ts`, `devScene.ts` | Debug view, debug script scenes, dev-page stub room |
| `rng.ts`, `region.test.ts`, `clauses.test.ts` | Seeded generator and tests; run by `npm test` through `scene/all-tests.ts` |
