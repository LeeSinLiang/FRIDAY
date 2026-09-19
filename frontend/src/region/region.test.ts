import assert from "node:assert/strict";
import test from "node:test";
import type { Listing } from "../lib/types";
import { findOpenPose, validatePlacement } from "../scene/placement";
import type { Instance, Pose, Product, Room } from "../scene/types";
import { listingToProduct, mmToCm, placeToCm, wallRect } from "./boundary";
import { countFree, footprintRect, intersect, nearestLegal, newMask, pointCm, stateAtPoint, union } from "./grid";
import { invariantMask } from "./invariants";
import { seeded, type Rng } from "./rng";
import { toSvg } from "./svg";
import { BLOCKED, CELL_CM, FREE, UNKNOWN, YAW_BINS, type FloorGrid, type Mask, type Scene } from "./types";

const room: Room = { roomId: "room", revision: 1, widthCm: 600, depthCm: 500, heightCm: 280 };
const sofa: Product = { productId: "sofa", name: "Sofa", widthCm: 220, depthCm: 95, heightCm: 74, color: "#b9542c", kind: "sofa" };
const chair: Product = { productId: "chair", name: "Chair", widthCm: 70, depthCm: 75, heightCm: 75, color: "#a98458", kind: "chair" };
const at = (instanceId: string, productId: string, xCm: number, zCm: number, yawRad = 0): Instance =>
  ({ instanceId, productId, pose: { xCm, zCm, yawRad } });

function eachPoint(mask: Mask, visit: (state: number, pose: Pose) => void): void {
  for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
    const [xCm, zCm] = pointCm(mask, ix, iz);
    visit(mask.data[iz * mask.shape[0] + ix], { xCm, zCm, yawRad: mask.yawRad });
  }
}

/** The editor's own verdict for a candidate at a pose, asked the way drag asks it. */
function editorAccepts(scene: Scene, product: Product, pose: Pose): boolean {
  const instances = [...scene.instances, { instanceId: "__probe__", productId: product.productId, pose }];
  return validatePlacement(scene.room, [...scene.products, product], instances, "__probe__", pose).valid;
}

function randomScene(rng: Rng): { scene: Scene; product: Product } {
  const sized = (id: string): Product => ({ productId: id, name: id, widthCm: rng.int(4, 50) * 5, depthCm: rng.int(4, 30) * 5,
    heightCm: rng.int(10, 250), color: "#888888", kind: "table" });
  const scene: Scene = { room: { ...room, widthCm: rng.int(40, 140) * 5, depthCm: rng.int(40, 120) * 5 }, products: [], instances: [] };
  for (let n = rng.int(0, 5); n > 0; n--) {
    const product = sized(`p${n}`);
    const preferred = { xCm: rng.int(0, scene.room.widthCm), zCm: rng.int(0, scene.room.depthCm), yawRad: rng.pick(YAW_BINS) };
    scene.products.push(product);
    const pose = findOpenPose(scene.room, scene.products, scene.instances, product, preferred, CELL_CM);
    if (pose) scene.instances.push({ instanceId: `i${n}`, productId: product.productId, pose });
  }
  return { scene, product: sized("candidate") };
}

test("mask is floor-grid-v1 sampled at grid points, both walls included", () => {
  const mask = newMask(room, 0);
  assert.deepEqual([mask.kind, mask.cellSizeCm, mask.originCm, mask.shape, mask.encoding],
    ["floor-grid-v1", 5, [0, 0], [121, 101], "uint8-x-fastest"]);
  assert.equal(mask.data.length, 121 * 101);
  assert.deepEqual([pointCm(mask, 0, 0), pointCm(mask, 120, 100)], [[0, 0], [600, 500]]);
});

test("empty room: legal centres are exactly those that keep the footprint inside, per rotation", () => {
  const scene: Scene = { room, products: [sofa], instances: [] };
  for (const yawRad of YAW_BINS) {
    const turned = Math.abs(Math.sin(yawRad)) > 0.5;
    const [extentX, extentZ] = turned ? [47.5, 110] : [110, 47.5];
    eachPoint(invariantMask(scene, { product: sofa }, yawRad), (state, pose) => {
      const inside = pose.xCm >= extentX && pose.xCm <= 600 - extentX && pose.zCm >= extentZ && pose.zCm <= 500 - extentZ;
      assert.equal(state === FREE, inside, `yaw ${yawRad} at ${pose.xCm},${pose.zCm}`);
    });
  }
});

test("a placed item erodes the legal region by the candidate's footprint; touching is allowed", () => {
  const scene: Scene = { room, products: [sofa, chair], instances: [at("sofa-1", "sofa", 300, 250)] };
  const mask = invariantMask(scene, { product: chair }, 0);
  // Sofa spans x 190..410, z 202.5..297.5. Chair half extents are 35 x 37.5.
  assert.equal(stateAtPoint(mask, 300, 250), BLOCKED);
  assert.equal(stateAtPoint(mask, 445, 250), FREE); // 410 + 35: edges touch
  assert.equal(stateAtPoint(mask, 440, 250), BLOCKED); // 5 cm of overlap
  assert.equal(stateAtPoint(mask, 300, 335), FREE); // 297.5 + 37.5
  assert.equal(stateAtPoint(mask, 300, 330), BLOCKED);
});

test("an item being moved does not collide with itself", () => {
  const scene: Scene = { room, products: [sofa], instances: [at("sofa-1", "sofa", 300, 250)] };
  assert.equal(stateAtPoint(invariantMask(scene, { product: sofa, movingInstanceId: "sofa-1" }, 0), 300, 250), FREE);
  assert.equal(stateAtPoint(invariantMask(scene, { product: sofa }, 0), 300, 250), BLOCKED);
});

test("PROPERTY: the mask and the editor's placement check agree at every grid point", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { scene, product } = randomScene(seeded(seed));
    for (const yawRad of YAW_BINS) eachPoint(invariantMask(scene, { product }, yawRad), (state, pose) => {
      assert.equal(state === FREE, editorAccepts(scene, product, pose), `seed ${seed} yaw ${yawRad} at ${pose.xCm},${pose.zCm}`);
    });
  }
});

test("PROPERTY: every pose the editor's 5 cm drag snap can produce is exactly one mask sample", () => {
  const rng = seeded(7);
  const { scene, product } = randomScene(rng);
  const mask = invariantMask(scene, { product }, 0);
  for (let n = 0; n < 2000; n++) {
    const dragged = { xCm: rng.next() * scene.room.widthCm, zCm: rng.next() * scene.room.depthCm };
    const snapped = { xCm: Math.round(dragged.xCm / 5) * 5, zCm: Math.round(dragged.zCm / 5) * 5, yawRad: 0 };
    assert.equal(stateAtPoint(mask, snapped.xCm, snapped.zCm) === FREE, editorAccepts(scene, product, snapped));
  }
});

function occupancyGrid(fill: number, marks: [number, number, number][]): FloorGrid {
  const grid: FloorGrid = { kind: "floor-grid-v1", cellSizeCm: 5, originCm: [0, 0], shape: [120, 100],
    encoding: "uint8-x-fastest", states: { unknown: 0, free: 1, blocked: 2 }, data: new Uint8Array(12000).fill(fill) };
  for (const [x, z, state] of marks) grid.data[z * 120 + x] = state;
  return grid;
}

test("occupancy: a blocked cell blocks every footprint overlapping it, and touching its edge is fine", () => {
  // Cell (60, 50) covers x 300..305, z 250..255. Chair half extents 35 x 37.5.
  const scene: Scene = { room, products: [chair], instances: [], occupancy: occupancyGrid(FREE, [[60, 50, BLOCKED]]) };
  const mask = invariantMask(scene, { product: chair }, 0);
  assert.equal(stateAtPoint(mask, 300, 250), BLOCKED);
  assert.equal(stateAtPoint(mask, 265, 250), FREE); // right edge at 300 touches the cell
  assert.equal(stateAtPoint(mask, 270, 250), BLOCKED);
  assert.equal(stateAtPoint(mask, 340, 250), FREE); // left edge at 305
  assert.equal(stateAtPoint(mask, 335, 250), BLOCKED);
});

test("occupancy: unobserved floor is never lit, and no data is not free space", () => {
  const unknownPatch: Scene = { room, products: [chair], instances: [], occupancy: occupancyGrid(FREE, [[60, 50, UNKNOWN]]) };
  assert.equal(stateAtPoint(invariantMask(unknownPatch, { product: chair }, 0), 300, 250), UNKNOWN);
  const nothingKnown: Scene = { ...unknownPatch, occupancy: occupancyGrid(UNKNOWN, []) };
  assert.equal(countFree(invariantMask(nothingKnown, { product: chair }, 0)), 0);
  const halfRoom: Scene = { ...unknownPatch, occupancy: { ...occupancyGrid(FREE, []), shape: [60, 100], data: new Uint8Array(6000).fill(FREE) } };
  const mask = invariantMask(halfRoom, { product: chair }, 0);
  assert.equal(stateAtPoint(mask, 200, 250), FREE);
  assert.equal(stateAtPoint(mask, 400, 250), UNKNOWN); // beyond the grid
});

test("PROPERTY: with occupancy, a lit point never overlaps a blocked or unknown cell", () => {
  for (let seed = 1; seed <= 15; seed++) {
    const rng = seeded(seed), marks: [number, number, number][] = [];
    for (let n = 0; n < 40; n++) marks.push([rng.int(0, 119), rng.int(0, 99), rng.pick([UNKNOWN, BLOCKED])]);
    const occupancy = occupancyGrid(FREE, marks);
    const scene: Scene = { room, products: [chair], instances: [], occupancy };
    const yawRad = rng.pick(YAW_BINS);
    eachPoint(invariantMask(scene, { product: chair }, yawRad), (state, pose) => {
      if (state !== FREE) return;
      const rect = footprintRect(chair, pose);
      for (const [x, z] of marks) {
        const overlaps = x * 5 < rect.maxX - 1e-6 && (x + 1) * 5 > rect.minX + 1e-6 && z * 5 < rect.maxZ - 1e-6 && (z + 1) * 5 > rect.minZ + 1e-6;
        assert.equal(overlaps, false, `seed ${seed}: lit ${pose.xCm},${pose.zCm} overlaps cell ${x},${z}`);
      }
    });
  }
});

test("intersect and union: blocked beats unknown beats free, and the reverse", () => {
  const make = (states: number[]): Mask => ({ ...newMask({ ...room, widthCm: 10, depthCm: 0 }, 0), data: Uint8Array.from(states) });
  const a = make([FREE, FREE, UNKNOWN]), b = make([FREE, BLOCKED, BLOCKED]);
  assert.deepEqual([...intersect(a, b).data], [FREE, BLOCKED, BLOCKED]);
  assert.deepEqual([...union(a, b).data], [FREE, FREE, UNKNOWN]);
  assert.deepEqual([...intersect(a, make([UNKNOWN, UNKNOWN, UNKNOWN])).data], [UNKNOWN, UNKNOWN, UNKNOWN]);
});

test("nearestLegal returns the closest lit centre, or null", () => {
  const scene: Scene = { room, products: [sofa, chair], instances: [at("sofa-1", "sofa", 300, 250)] };
  const mask = invariantMask(scene, { product: chair }, 0);
  assert.deepEqual(nearestLegal(mask, { xCm: 300, zCm: 262, yawRad: 0 }), { xCm: 300, zCm: 335, yawRad: 0 });
  assert.deepEqual(nearestLegal(mask, { xCm: 100, zCm: 100, yawRad: 0 }), { xCm: 100, zCm: 100, yawRad: 0 });
  assert.equal(nearestLegal(newMask(room, 0), { xCm: 1, zCm: 1, yawRad: 0 }), null);
});

test("boundary: mm become cm in one place, walls map to compass sides, listings become products", () => {
  assert.deepEqual([mmToCm(1524), mmToCm(762), mmToCm(1185)], [152.4, 76.2, 118.5]);
  assert.deepEqual(placeToCm([
    { k: "distance_min", ref: { kind: "any_wall" }, mm: 1524 }, { k: "near", ref: { kind: "window", id: "w1" } },
  ]), [{ k: "distance_min", ref: { kind: "any_wall" }, cm: 152.4 }, { k: "near", ref: { kind: "window", id: "w1" } }]);
  assert.deepEqual([wallRect(room, "n"), wallRect(room, "e")],
    [{ minX: 0, maxX: 600, minZ: 0, maxZ: 0 }, { minX: 600, maxX: 600, minZ: 0, maxZ: 500 }]);
  const listing: Listing = { id: "ikea-193.025.39", source: "ikea", title: "POÄNG armchair", category: "armchair", price_cents: 12900,
    dims_mm: { w: 680, d: 820, h: 1000 }, model_url: null, thumb_url: "", colour_hex: ["#c9a77c"], materials: ["birch"] };
  assert.deepEqual(listingToProduct(listing), { productId: "ikea-193.025.39", name: "POÄNG armchair", widthCm: 68, depthCm: 82,
    heightCm: 100, color: "#c9a77c", kind: "chair" });
});

test("debug SVG shows the room, each placed item, the lit region and unobserved floor", () => {
  const scene: Scene = { room, products: [sofa, chair], instances: [at("sofa-1", "sofa", 300, 250, Math.PI / 2)],
    occupancy: occupancyGrid(FREE, [[10, 10, UNKNOWN]]),
    openings: [{ id: "d1", kind: "door", wall: "w", startCm: 60, widthCm: 90 }] };
  const svg = toSvg(scene, invariantMask(scene, { product: chair }, 0), { title: "chair <test>" });
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="-30 -30 660 560"/);
  assert.match(svg, /<rect x="0" y="0" width="600" height="500" fill="none"/);
  const points = /<polygon points="([^"]+)"/.exec(svg)?.[1].split(" ").sort();
  assert.deepEqual(points, ["252.5,140.0", "252.5,360.0", "347.5,140.0", "347.5,360.0"]); // sofa, quarter turn: 95 x 220
  assert.match(svg, /<title>door d1<\/title>/);
  assert.ok(svg.includes('fill="#3fae6b"') && svg.includes('fill="#e0a030"'));
  assert.ok(!svg.includes("<test>") && svg.endsWith("</svg>"));
});
