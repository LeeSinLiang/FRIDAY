// Mask construction and combination. Pure.

import type { Pose, Product, Room } from "../scene/types";
import { BLOCKED, CELL_CM, FREE, UNKNOWN, type Mask, type Rect } from "./types";

const STATES = { unknown: 0, free: 1, blocked: 2 } as const;

/** Grid POINTS along one axis, both walls included: a 600 cm room has points at 0, 5, ... 600. */
const pointCount = (lengthCm: number) => Math.floor(lengthCm / CELL_CM + 1e-9) + 1;

export function newMask(room: Room, yawRad: number, fill: number = BLOCKED): Mask {
  const shape: [number, number] = [pointCount(room.widthCm), pointCount(room.depthCm)];
  return {
    kind: "floor-grid-v1", cellSizeCm: CELL_CM, originCm: [0, 0], shape,
    encoding: "uint8-x-fastest", states: STATES, yawRad,
    data: new Uint8Array(shape[0] * shape[1]).fill(fill),
  };
}

export const pointCm = (mask: Mask, ix: number, iz: number): [number, number] =>
  [mask.originCm[0] + ix * mask.cellSizeCm, mask.originCm[1] + iz * mask.cellSizeCm];

/** Fill a mask by asking, for every grid point, what state a pose centred there has. */
export function fillMask(mask: Mask, stateAt: (xCm: number, zCm: number) => number): Mask {
  const [countX, countZ] = mask.shape;
  for (let iz = 0; iz < countZ; iz++) for (let ix = 0; ix < countX; ix++) {
    const [xCm, zCm] = pointCm(mask, ix, iz);
    mask.data[iz * countX + ix] = stateAt(xCm, zCm);
  }
  return mask;
}

/** Floor rectangle covered by a product at a quarter-turn pose. Same extents formula as the
 *  scene's placement check, so the two agree on where an item's edges are. */
export function footprintRect(product: Product, pose: Pose): Rect {
  const c = Math.abs(Math.cos(pose.yawRad)), s = Math.abs(Math.sin(pose.yawRad));
  const extentX = c * product.widthCm / 2 + s * product.depthCm / 2;
  const extentZ = s * product.widthCm / 2 + c * product.depthCm / 2;
  return { minX: pose.xCm - extentX, maxX: pose.xCm + extentX, minZ: pose.zCm - extentZ, maxZ: pose.zCm + extentZ };
}

function combine(a: Mask, b: Mask, pick: (x: number, y: number) => number): Mask {
  if (a.shape[0] !== b.shape[0] || a.shape[1] !== b.shape[1]) throw new Error("Masks have different shapes");
  const data = new Uint8Array(a.data.length);
  for (let i = 0; i < data.length; i++) data[i] = pick(a.data[i], b.data[i]);
  return { ...a, data };
}

/** Both must allow it. Blocked beats unknown beats free: a known collision is reported as one. */
export const intersect = (a: Mask, b: Mask): Mask => combine(a, b, (x, y) =>
  x === BLOCKED || y === BLOCKED ? BLOCKED : x === UNKNOWN || y === UNKNOWN ? UNKNOWN : FREE);

/** Either may allow it. */
export const union = (a: Mask, b: Mask): Mask => combine(a, b, (x, y) =>
  x === FREE || y === FREE ? FREE : x === UNKNOWN || y === UNKNOWN ? UNKNOWN : BLOCKED);

export const countFree = (mask: Mask): number => mask.data.reduce((n, state) => n + (state === FREE ? 1 : 0), 0);

export function stateAtPoint(mask: Mask, xCm: number, zCm: number): number {
  const ix = Math.round((xCm - mask.originCm[0]) / mask.cellSizeCm);
  const iz = Math.round((zCm - mask.originCm[1]) / mask.cellSizeCm);
  if (ix < 0 || iz < 0 || ix >= mask.shape[0] || iz >= mask.shape[1]) return BLOCKED;
  return mask.data[iz * mask.shape[0] + ix];
}

/** Closest legal centre to a pose, in cm, or null when nothing is legal. Ties break toward low z, then low x. */
export function nearestLegal(mask: Mask, pose: Pose): Pose | null {
  let best: Pose | null = null, bestDistance = Infinity;
  const [countX, countZ] = mask.shape;
  for (let iz = 0; iz < countZ; iz++) for (let ix = 0; ix < countX; ix++) {
    if (mask.data[iz * countX + ix] !== FREE) continue;
    const [xCm, zCm] = pointCm(mask, ix, iz);
    const distance = (xCm - pose.xCm) ** 2 + (zCm - pose.zCm) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = { xCm, zCm, yawRad: mask.yawRad }; }
  }
  return best;
}
