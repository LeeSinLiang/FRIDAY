// Region solver types. Pure data: no React, no renderer.
// Everything here is in the scene's space: centimetres, origin at a floor corner, +X width, +Z depth.

import type { Instance, Product, Room } from "../scene/types";

/** Fixed solve resolution. Deliberately NOT derived from SCENE_UNIT_CM: that setting changes how
 *  big things are drawn, and must never change whether a chair fits. */
export const CELL_CM = 5;

export const UNKNOWN = 0;
export const FREE = 1;
export const BLOCKED = 2;

/** The floor-grid-v1 spatial artifact from the room-capture plan, used unchanged for input and output. */
export type FloorGrid = {
  kind: "floor-grid-v1";
  cellSizeCm: number;
  originCm: [number, number];
  shape: [number, number]; // [countX, countZ]
  encoding: "uint8-x-fastest"; // index = z * countX + x
  states: { unknown: 0; free: 1; blocked: 2 };
  data: Uint8Array;
};

/** Where an item's CENTRE may go, for one rotation.
 *
 *  Sampled at grid POINTS (x = origin + i * cellSizeCm), not cell centres, so every pose the
 *  editor's drag can snap to is exactly one sample. shape is therefore one larger than the room's
 *  cell count on each axis. free = legal, blocked = illegal, unknown = no data; only free is lit. */
export type Mask = FloorGrid & { yawRad: number };

export type WallSide = "n" | "e" | "s" | "w";

/** Proposed optional addition to the scene's Room. Absent today; the solver degrades without it. */
export type Opening = {
  id: string;
  kind: "door" | "window";
  wall: WallSide;
  startCm: number; // along the wall: +X for n and s, +Z for e and w
  widthCm: number;
  swingCm?: number; // doors: how far the leaf sweeps into the room. Defaults to widthCm.
};

export type Scene = {
  room: Room;
  products: Product[];
  instances: Instance[];
  openings?: Opening[];
  /** Static obstacles and unobserved floor from a reconstructed room, as cell AREAS. */
  occupancy?: FloorGrid;
};

/** Axis-aligned rectangle in cm. */
export type Rect = { minX: number; minZ: number; maxX: number; maxZ: number };

export const YAW_BINS: readonly number[] = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
