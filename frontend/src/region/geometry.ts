// Axis-aligned rectangle helpers, in cm. Pure.

import type { Room } from "../scene/types";
import { wallBounds } from "./boundary";
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
  // startCm runs along the wall from the walls' own corner, so openings move with wallBounds.
  const walls = wallBounds(room);
  const alongX = [walls.minX + opening.startCm, walls.minX + opening.startCm + opening.widthCm];
  const alongZ = [walls.minZ + opening.startCm, walls.minZ + opening.startCm + opening.widthCm];
  if (opening.wall === "n") return { minX: alongX[0], maxX: alongX[1], minZ: walls.minZ, maxZ: walls.minZ + depthCm };
  if (opening.wall === "s") return { minX: alongX[0], maxX: alongX[1], minZ: walls.maxZ - depthCm, maxZ: walls.maxZ };
  if (opening.wall === "w") return { minX: walls.minX, maxX: walls.minX + depthCm, minZ: alongZ[0], maxZ: alongZ[1] };
  return { minX: walls.maxX - depthCm, maxX: walls.maxX, minZ: alongZ[0], maxZ: alongZ[1] };
}
