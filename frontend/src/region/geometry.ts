// Axis-aligned rectangle helpers, in cm. Pure.

import type { Room } from "../scene/types";
import type { Opening, Rect } from "./types";

export const EPSILON_CM = 1e-6;

/** Shortest distance between two rectangles' edges; 0 when they touch or overlap. */
export function gap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

/** True when the rectangles share floor area. Touching edges do not count, matching the editor. */
export const overlapsArea = (a: Rect, b: Rect): boolean =>
  a.minX < b.maxX - EPSILON_CM && b.minX < a.maxX - EPSILON_CM && a.minZ < b.maxZ - EPSILON_CM && b.minZ < a.maxZ - EPSILON_CM;

/** The floor in front of an opening, reaching depthCm into the room. depthCm 0 gives the opening itself. */
export function openingZone(room: Room, opening: Opening, depthCm: number): Rect {
  const a = opening.startCm, b = opening.startCm + opening.widthCm;
  if (opening.wall === "n") return { minX: a, maxX: b, minZ: 0, maxZ: depthCm };
  if (opening.wall === "s") return { minX: a, maxX: b, minZ: room.depthCm - depthCm, maxZ: room.depthCm };
  if (opening.wall === "w") return { minX: 0, maxX: depthCm, minZ: a, maxZ: b };
  return { minX: room.widthCm - depthCm, maxX: room.widthCm, minZ: a, maxZ: b };
}
