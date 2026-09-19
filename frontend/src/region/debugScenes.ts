// Debug scenes for `npm run region:debug`. Node only; never imported by the app.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCTS, ROOM } from "../scene/fixtures";
import type { Instance } from "../scene/types";
import { countFree } from "./grid";
import { invariantMask } from "./invariants";
import { toSvg } from "./svg";
import { BLOCKED, FREE, UNKNOWN, YAW_BINS, type FloorGrid, type Scene } from "./types";

const [sofa, table, chair] = PRODUCTS;
const placed: Instance[] = [
  { instanceId: "sofa-1", productId: sofa.productId, pose: { xCm: 300, zCm: 60, yawRad: 0 } },
  { instanceId: "table-1", productId: table.productId, pose: { xCm: 300, zCm: 200, yawRad: 0 } },
];

/** A scanned-room stand-in: a fixed cabinet in one corner and floor nobody observed in another. */
function scannedFloor(): FloorGrid {
  const data = new Uint8Array(120 * 100).fill(FREE);
  for (let z = 70; z < 100; z++) for (let x = 0; x < 24; x++) data[z * 120 + x] = BLOCKED;
  for (let z = 60; z < 100; z++) for (let x = 95; x < 120; x++) data[z * 120 + x] = UNKNOWN;
  return { kind: "floor-grid-v1", cellSizeCm: 5, originCm: [0, 0], shape: [120, 100], encoding: "uint8-x-fastest",
    states: { unknown: 0, free: 1, blocked: 2 }, data };
}

export async function writeDebugScenes(outDir: string): Promise<string[]> {
  const scenes: [string, Scene][] = [
    ["furnished", { room: ROOM, products: PRODUCTS, instances: placed }],
    ["scanned", { room: ROOM, products: PRODUCTS, instances: placed, occupancy: scannedFloor() }],
  ];
  const lines: string[] = [];
  for (const [name, scene] of scenes) for (const yawRad of YAW_BINS.slice(0, 2)) {
    const started = performance.now();
    const mask = invariantMask(scene, { product: chair }, yawRad);
    const ms = (performance.now() - started).toFixed(1);
    const degrees = Math.round((yawRad * 180) / Math.PI);
    const file = join(outDir, `${name}-chair-${degrees}.svg`);
    await writeFile(file, toSvg(scene, mask, { title: `${name}: ${chair.name}, yaw ${degrees}, ${countFree(mask)} legal centres` }));
    lines.push(`${file}  ${countFree(mask)} legal centres  ${ms} ms`);
  }
  return lines;
}
