// Static obstacles from a reconstructed room (floor-grid-v1 cell AREAS). Pure.
// A footprint is tested against every cell it overlaps, not just its centre or corners.

import { BLOCKED, FREE, UNKNOWN, type FloorGrid, type Rect } from "./types";

export type OccupancyIndex = { grid: FloorGrid; blocked: Uint32Array; unknown: Uint32Array };

const EDGE_EPSILON_CM = 1e-6; // touching a cell's edge is not overlapping it

function summedArea(grid: FloorGrid, state: number): Uint32Array {
  const [countX, countZ] = grid.shape, stride = countX + 1;
  const sums = new Uint32Array(stride * (countZ + 1));
  for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) {
    const hit = grid.data[z * countX + x] === state ? 1 : 0;
    sums[(z + 1) * stride + x + 1] = hit + sums[z * stride + x + 1] + sums[(z + 1) * stride + x] - sums[z * stride + x];
  }
  return sums;
}

/** Summed-area tables make each footprint test four lookups instead of a scan over its cells. */
export function indexOccupancy(grid: FloorGrid): OccupancyIndex {
  if (grid.encoding !== "uint8-x-fastest" || grid.data.length !== grid.shape[0] * grid.shape[1])
    throw new Error("Occupancy grid is not a valid floor-grid-v1");
  return { grid, blocked: summedArea(grid, BLOCKED), unknown: summedArea(grid, UNKNOWN) };
}

function countIn(sums: Uint32Array, stride: number, x0: number, z0: number, x1: number, z1: number): number {
  return sums[(z1 + 1) * stride + x1 + 1] - sums[z0 * stride + x1 + 1] - sums[(z1 + 1) * stride + x0] + sums[z0 * stride + x0];
}

/** BLOCKED if the footprint touches any blocked cell; else UNKNOWN if it touches unobserved floor
 *  or leaves the grid (no data is never evidence of free space); else FREE. */
export function occupancyState(index: OccupancyIndex, rect: Rect): number {
  const { grid } = index, [countX, countZ] = grid.shape, size = grid.cellSizeCm;
  const x0 = Math.floor((rect.minX - grid.originCm[0] + EDGE_EPSILON_CM) / size);
  const z0 = Math.floor((rect.minZ - grid.originCm[1] + EDGE_EPSILON_CM) / size);
  const x1 = Math.ceil((rect.maxX - grid.originCm[0] - EDGE_EPSILON_CM) / size) - 1;
  const z1 = Math.ceil((rect.maxZ - grid.originCm[1] - EDGE_EPSILON_CM) / size) - 1;
  const leavesGrid = x0 < 0 || z0 < 0 || x1 >= countX || z1 >= countZ;
  const cx0 = Math.max(x0, 0), cz0 = Math.max(z0, 0), cx1 = Math.min(x1, countX - 1), cz1 = Math.min(z1, countZ - 1);
  if (cx0 > cx1 || cz0 > cz1) return UNKNOWN;
  const stride = countX + 1;
  if (countIn(index.blocked, stride, cx0, cz0, cx1, cz1) > 0) return BLOCKED;
  if (leavesGrid || countIn(index.unknown, stride, cx0, cz0, cx1, cz1) > 0) return UNKNOWN;
  return FREE;
}
