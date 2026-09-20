// Why nothing fits, in words a shopper can act on. Pure.
// "Your room can't take it" is an answer only a vendor-neutral marketplace can give, so it should read well.

import type { PlaceClause } from "../lib/dsl/schema";
import type { Product, Room } from "../scene/types";
import { placeToCm, wallBounds, type PlaceCm } from "./boundary";
import { floorRegion, longestSpans } from "./floor";
import { wallClearances } from "./clauses";
import { footprintRect } from "./grid";
import { YAW_BINS } from "./types";

export type Solver = (place: PlaceClause[]) => { legalCounts: number[] };

const round = (cm: number) => Math.round(cm);
const total = (counts: number[]) => counts.reduce((sum, n) => sum + n, 0);

/** Simple arithmetic first: the item plus the wall clearances asked for, against the longest unbroken
 *  run of floor each way. For a rectangle that is its width and depth; for any other shape it is the most
 *  generous reading, so "needs more than this" is always true when it is said. */
function spanShortfall(room: Room, product: Product, place: PlaceCm[]): string | null {
  const need = wallClearances(place);
  const { acrossCm, deepCm } = longestSpans(floorRegion(room));
  let best: { axis: string; needs: number; has: number } | null = null;
  for (const yawRad of YAW_BINS.slice(0, 2)) {
    const rect = footprintRect(product, { xCm: 0, zCm: 0, yawRad });
    const width = rect.maxX - rect.minX + need.w + need.e, depth = rect.maxZ - rect.minZ + need.n + need.s;
    const short = width > acrossCm + 1e-6 ? { axis: "width", needs: width, has: acrossCm }
      : depth > deepCm + 1e-6 ? { axis: "depth", needs: depth, has: deepCm } : null;
    if (!short) return null; // this rotation has the span, so the cause is something else
    if (!best || short.needs - short.has < best.needs - best.has) best = short;
  }
  return best && `needs ${round(best.needs)} cm of ${best.axis}, this room has ${round(best.has)} cm`;
}

const describeRef = (clause: PlaceCm) => clause.ref.kind === "any_wall" ? "any wall" : "id" in clause.ref && clause.ref.id ? clause.ref.id : `the ${clause.ref.kind}`;
const WORDS: Record<PlaceCm["k"], string> = { near: "near", against: "against", distance_min: "away from", clear: "clear of", on: "on", not_blocking: "not blocking" };
const describe = (clause: PlaceCm) => `${clause.cm === undefined ? "" : `${round(clause.cm)} cm `}${WORDS[clause.k]} ${describeRef(clause)}`;

/**
 * Explain an empty solution from its binding constraint.
 *
 * Args:
 *   room, product: what is being placed where.
 *   place: the clauses that produced nothing.
 *   solveWith: re-runs the solver with a different clause list (injected to keep this file pure).
 */
export function explainNothingFits(room: Room, product: Product, place: PlaceClause[], solveWith: Solver): string {
  const openFloor = total(solveWith([]).legalCounts);
  if (openFloor === 0) {
    const [w, d] = [product.widthCm, product.depthCm].map(round);
    const floor = wallBounds(room), acrossCm = floor.maxX - floor.minX, deepCm = floor.maxZ - floor.minZ;
    const tooBig = Math.min(w, d) > Math.min(acrossCm, deepCm) || Math.max(w, d) > Math.max(acrossCm, deepCm);
    if (product.heightCm > room.heightCm) return `it is ${round(product.heightCm)} cm tall and the ceiling is ${round(room.heightCm)} cm`;
    return tooBig ? `it is ${w} × ${d} cm and ${room.spatial?.freeAreas.length ? "the usable floor" : "the room"} is ${round(acrossCm)} × ${round(deepCm)} cm`
      : `there is no free floor big enough for its ${w} × ${d} cm footprint`;
  }
  const span = spanShortfall(room, product, placeToCm(place));
  if (span) return span;
  // Otherwise find the one request that, if given up, makes room. Costs one solve per clause, only on failure.
  const culprits = place.map((_, index) => ({ index, freed: total(solveWith(place.filter((__, i) => i !== index)).legalCounts) }))
    .filter((c) => c.freed > 0).sort((a, b) => b.freed - a.freed);
  if (culprits.length) return `these can't all hold here; without “${describe(placeToCm([place[culprits[0].index]])[0])}” it fits`;
  return "these requests can't all hold in this room";
}
