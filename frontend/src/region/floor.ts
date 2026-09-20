// What a wall IS: the boundary of the floor an item may stand on. Pure.
//
// The solver used to assume a rectangle: four walls along the bounding box of the free floor. Real
// floors are L-shaped, have alcoves, pillars and islands, and open into other spaces. So the walls
// are derived instead. The floor is rasterised onto a COMPRESSED grid whose lines are exactly the
// edges that occur in the room (free areas and portal ends), which keeps every
// coordinate exact: no 5 cm rounding of a wall that stands at x = 787. Every cell side where floor
// meets not-floor is a boundary edge, facing the way a wall on that side would. Distance to "any
// wall" is then the distance to the nearest boundary edge that is not a portal, with no special
// case for the room's shape.
//
// A PORTAL is a stretch of boundary that is not a wall: a doorway, or the open side of a living area
// that runs on into the next space. It is authored data, never guessed (see roomOpenings.ts).

import type { Room } from "../scene/types";
import type { Rect, WallSide } from "./types";

const EPSILON_CM = 1e-6;

/** A stretch of boundary that is open rather than solid. Axis-aligned, in scene centimetres. */
export type Portal = { id: string; from: [number, number]; to: [number, number]; leadsTo?: string };

/** One straight piece of the floor's boundary. `side` is the compass wall it behaves as: an edge
 *  with not-floor to its north (smaller z) is a north wall, however many of them the room has. */
export type BoundaryEdge = { rect: Rect; side: WallSide; portalId?: string };

export type FloorRegion = {
  /** Compressed grid lines, ascending. Cell (i, j) spans xs[i]..xs[i+1] by zs[j]..zs[j+1]. */
  xs: number[];
  zs: number[];
  /** 1 where the cell is floor. Index j * (xs.length - 1) + i. */
  inside: Uint8Array;
  edges: BoundaryEdge[];
};

const unique = (values: number[]): number[] => [...new Set(values)].sort((a, b) => a - b);
const contains = (rect: Rect, x: number, z: number) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;

/**
 * The rectangles that make up the floor. For a prepared room, its reviewed free areas; otherwise the room itself.
 *
 * Fixed OBSTACLES are deliberately not part of this. They block placement (the editor's check sees to
 * that), but in the rooms we have they are scanned furniture, a sofa or a coffee table that came with the
 * capture, and "four feet from any wall" must not mean four feet from a coffee table. Nothing in an
 * obstacle says whether it is architecture, and guessing from its label would be a heuristic. A pillar or
 * an island that SHOULD count as a wall is expressed by cutting it out of the free areas, which is how the
 * Haussmann room already records its partitions.
 */
function floorRects(room: Room): Rect[] {
  const areas = room.spatial?.freeAreas ?? [];
  if (!areas.length) return [{ minX: 0, maxX: room.widthCm, minZ: 0, maxZ: room.depthCm }];
  return areas.map((a) => ({ minX: a.minXcm, maxX: a.maxXcm, minZ: a.minZcm, maxZ: a.maxZcm }));
}

const onPortal = (rect: Rect, portal: Portal): boolean => {
  const [minX, maxX] = [Math.min(portal.from[0], portal.to[0]), Math.max(portal.from[0], portal.to[0])];
  const [minZ, maxZ] = [Math.min(portal.from[1], portal.to[1]), Math.max(portal.from[1], portal.to[1])];
  return rect.minX >= minX - EPSILON_CM && rect.maxX <= maxX + EPSILON_CM && rect.minZ >= minZ - EPSILON_CM && rect.maxZ <= maxZ + EPSILON_CM;
};

/** Join collinear pieces that touch, face the same way and share a portal (or the lack of one). */
function mergeEdges(pieces: BoundaryEdge[]): BoundaryEdge[] {
  const alongX = (edge: BoundaryEdge) => edge.side === "n" || edge.side === "s";
  const key = (edge: BoundaryEdge) => `${edge.side}|${edge.portalId ?? ""}|${alongX(edge) ? edge.rect.minZ : edge.rect.minX}`;
  const groups = new Map<string, BoundaryEdge[]>();
  for (const piece of pieces) groups.set(key(piece), [...(groups.get(key(piece)) ?? []), piece]);
  const merged: BoundaryEdge[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (alongX(a) ? a.rect.minX - b.rect.minX : a.rect.minZ - b.rect.minZ));
    for (const piece of group) {
      const last = merged[merged.length - 1];
      const joins = last && key(last) === key(piece)
        && Math.abs((alongX(piece) ? last.rect.maxX - piece.rect.minX : last.rect.maxZ - piece.rect.minZ)) < EPSILON_CM;
      if (joins) last.rect = alongX(piece) ? { ...last.rect, maxX: piece.rect.maxX } : { ...last.rect, maxZ: piece.rect.maxZ };
      else merged.push({ ...piece, rect: { ...piece.rect } });
    }
  }
  return merged;
}

/** The floor of a room and its boundary. Portals only relabel boundary pieces; they never add or remove floor. */
export function floorRegion(room: Room, portals: Portal[] = []): FloorRegion {
  const free = floorRects(room);
  const ends = portals.flatMap((p) => [p.from, p.to]);
  const xs = unique(free.flatMap((r) => [r.minX, r.maxX]).concat(ends.map((e) => e[0])));
  const zs = unique(free.flatMap((r) => [r.minZ, r.maxZ]).concat(ends.map((e) => e[1])));
  const countX = xs.length - 1, countZ = zs.length - 1;
  const inside = new Uint8Array(Math.max(countX, 0) * Math.max(countZ, 0));
  for (let j = 0; j < countZ; j++) for (let i = 0; i < countX; i++) {
    const x = (xs[i] + xs[i + 1]) / 2, z = (zs[j] + zs[j + 1]) / 2;
    inside[j * countX + i] = free.some((r) => contains(r, x, z)) ? 1 : 0;
  }
  const isFloor = (i: number, j: number) => i >= 0 && j >= 0 && i < countX && j < countZ && inside[j * countX + i] === 1;
  const pieces: BoundaryEdge[] = [];
  const add = (rect: Rect, side: WallSide) => {
    const portal = portals.find((p) => onPortal(rect, p));
    pieces.push({ rect, side, ...(portal ? { portalId: portal.id } : {}) });
  };
  for (let j = 0; j < countZ; j++) for (let i = 0; i < countX; i++) {
    if (!isFloor(i, j)) continue;
    if (!isFloor(i, j - 1)) add({ minX: xs[i], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j] }, "n");
    if (!isFloor(i, j + 1)) add({ minX: xs[i], maxX: xs[i + 1], minZ: zs[j + 1], maxZ: zs[j + 1] }, "s");
    if (!isFloor(i - 1, j)) add({ minX: xs[i], maxX: xs[i], minZ: zs[j], maxZ: zs[j + 1] }, "w");
    if (!isFloor(i + 1, j)) add({ minX: xs[i + 1], maxX: xs[i + 1], minZ: zs[j], maxZ: zs[j + 1] }, "e");
  }
  return { xs, zs, inside, edges: mergeEdges(pieces) };
}

/** The boundary pieces that are solid, optionally only those facing one way. Portals are never walls. */
export const wallEdges = (region: FloorRegion, side?: WallSide): BoundaryEdge[] =>
  region.edges.filter((edge) => edge.portalId === undefined && (side === undefined || edge.side === side));

/** The longest unbroken run of floor along each axis: the most generous honest reading of "how wide
 *  is this room" for a floor that is not a rectangle. For a rectangle it is its width and depth. */
export function longestSpans(region: FloorRegion): { acrossCm: number; deepCm: number } {
  const countX = region.xs.length - 1, countZ = region.zs.length - 1;
  const longest = (outer: number, inner: number, floor: (o: number, n: number) => boolean, size: (n: number) => number) => {
    let best = 0;
    for (let o = 0; o < outer; o++) {
      let run = 0;
      for (let n = 0; n < inner; n++) { run = floor(o, n) ? run + size(n) : 0; best = Math.max(best, run); }
    }
    return best;
  };
  return {
    acrossCm: longest(countZ, countX, (j, i) => region.inside[j * countX + i] === 1, (i) => region.xs[i + 1] - region.xs[i]),
    deepCm: longest(countX, countZ, (i, j) => region.inside[j * countX + i] === 1, (j) => region.zs[j + 1] - region.zs[j]),
  };
}
