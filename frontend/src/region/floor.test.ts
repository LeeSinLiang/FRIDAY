import assert from "node:assert/strict";
import test from "node:test";
import cgArch from "../../../shared/rooms/cg-arch-interior/manifest.json";
import cgArchSpatial from "../../../shared/rooms/cg-arch-interior/spatial.json";
import fixtures from "../../../shared/scene-fixtures.json";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Product, Room } from "../scene/types";
import { wallBounds } from "./boundary";
import { floorRegion, longestSpans, wallEdges } from "./floor";
import { footprintRect, pointCm } from "./grid";
import { invariantMask } from "./invariants";
import { seeded } from "./rng";
import { solve } from "./solve";
import { FREE, YAW_BINS, type Scene, type WallSide } from "./types";

const prepared = cgArch.room as unknown as Room;
const area = (minXcm: number, maxXcm: number, minZcm: number, maxZcm: number) => ({ minXcm, maxXcm, minZcm, maxZcm });
const withFloor = (widthCm: number, depthCm: number, freeAreas: ReturnType<typeof area>[], obstacles: NonNullable<Room["spatial"]>["obstacles"] = []): Room =>
  ({ ...prepared, widthCm, depthCm, spatial: { freeAreas, obstacles } });

// An L: a 400 x 300 bar across the top and a 200 x 200 leg down the left.
const L_ROOM = withFloor(400, 500, [area(0, 400, 0, 300), area(0, 200, 300, 500)]);
const box: Product = { productId: "box", name: "box", widthCm: 40, depthCm: 40, heightCm: 40, color: "#888", kind: "chair" };
const sides = (room: Room) => wallEdges(floorRegion(room)).map((edge) => `${edge.side} ${edge.rect.minX},${edge.rect.minZ} -> ${edge.rect.maxX},${edge.rect.maxZ}`).sort();

test("a rectangle has four walls; an L has six, two of them facing south and two facing east", () => {
  assert.deepEqual(sides(fixtures.room as Room), ["e 600,0 -> 600,500", "n 0,0 -> 600,0", "s 0,500 -> 600,500", "w 0,0 -> 0,500"]);
  assert.deepEqual(sides(L_ROOM), [
    "e 200,300 -> 200,500", "e 400,0 -> 400,300", "n 0,0 -> 400,0",
    "s 0,500 -> 200,500", "s 200,300 -> 400,300", "w 0,0 -> 0,500", // the west wall is ONE wall, joined across both free areas
  ]);
  assert.deepEqual(longestSpans(floorRegion(L_ROOM)), { acrossCm: 400, deepCm: 500 });
  assert.deepEqual(longestSpans(floorRegion(fixtures.room as Room)), { acrossCm: 600, deepCm: 500 });
});

test("coordinates stay exact: a wall at x = 787 is at 787, not at the nearest 5 cm", () => {
  const room = { ...prepared, spatial: cgArchSpatial as Room["spatial"] };
  assert.deepEqual(floorRegion(room).xs, [787, 1121]);
  assert.deepEqual(floorRegion(room).zs, [180, 760]);
});

test("a pillar cut out of the free floor is a wall with no special case; scanned furniture recorded as an obstacle is not", () => {
  // A 60 x 40 pillar at the centre of a 600 x 500 floor, expressed the way the Haussmann room records partitions: as absence.
  const aroundPillar = [area(0, 600, 0, 230), area(0, 600, 270, 500), area(0, 270, 230, 270), area(330, 600, 230, 270)];
  const room = withFloor(600, 500, aroundPillar);
  const inner = wallEdges(floorRegion(room)).filter((edge) => edge.rect.minX > 0 && edge.rect.maxX < 600 && edge.rect.minZ > 0 && edge.rect.maxZ < 500);
  // Floor to the north of the pillar sees a wall to its SOUTH, and so on round it.
  assert.deepEqual(inner.map((edge) => `${edge.side} ${edge.rect.minX},${edge.rect.minZ} -> ${edge.rect.maxX},${edge.rect.maxZ}`).sort(),
    ["e 270,230 -> 270,270", "n 270,270 -> 330,270", "s 270,230 -> 330,230", "w 330,230 -> 330,270"]);
  const clause: PlaceClause[] = [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 1000 }];
  const at = (mask: { data: Uint8Array; shape: [number, number] }, xCm: number, zCm: number) => mask.data[Math.round(zCm / 5) * mask.shape[0] + Math.round(xCm / 5)];
  const kept = solve({ room, products: [], instances: [] }, { product: box }, clause).masks[0];
  assert.equal(at(kept, 200, 250), 2, "50 cm from the pillar is not 100 cm from every wall");
  assert.equal(at(kept, 140, 250), 1, "110 cm from the pillar and 120 from the west wall is");

  // The same 60 x 40 box recorded as a scanned sofa: nothing may overlap it, but it is not a wall.
  const sofa = withFloor(600, 500, [area(0, 600, 0, 500)], [{ obstacleId: "sofa", label: "Scanned sofa", xCm: 300, zCm: 250, widthCm: 40, depthCm: 60, yawRad: Math.PI / 2 }]);
  assert.equal(wallEdges(floorRegion(sofa)).length, 4);
  const beside = solve({ room: sofa, products: [], instances: [] }, { product: box }, clause).masks[0];
  assert.equal(at(beside, 200, 250), 1, "50 cm from a scanned sofa is fine for a clause about walls");
  assert.equal(at(beside, 300, 250), 2, "standing on it is still refused, by the editor's own check");
});

test("L-shaped floor: the inner corner is a wall, which a box around the floor cannot know", () => {
  const scene: Scene = { room: L_ROOM, products: [], instances: [] };
  const mask = solve(scene, { product: box }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 1000 }]).masks[0];
  const at = (xCm: number, zCm: number) => mask.data[Math.round(zCm / 5) * mask.shape[0] + Math.round(xCm / 5)];
  // Centre (150, 250): 130 from the west wall, 230 from the north, and the box around the floor would call it 230 from
  // everything else. But its corner is 42 cm (30 across, 30 down) from the inner corner at (200, 300).
  assert.equal(at(150, 250), 2);
  assert.equal(at(150, 150), 1, "in the bar, 100 cm clear of north, west and the inner walls");
  assert.equal(solve(scene, { product: box }, []).masks[0].data[Math.round(250 / 5) * mask.shape[0] + Math.round(150 / 5)], 1, "legal before the clause");
  // Every lit centre really is 100 cm from every boundary piece, measured independently.
  const edges = wallEdges(floorRegion(L_ROOM));
  let lit = 0;
  for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
    if (mask.data[iz * mask.shape[0] + ix] !== FREE) continue;
    lit++;
    const [x, z] = pointCm(mask, ix, iz);
    for (const edge of edges) {
      const dx = Math.max(0, edge.rect.minX - (x + 20), (x - 20) - edge.rect.maxX), dz = Math.max(0, edge.rect.minZ - (z + 20), (z - 20) - edge.rect.maxZ);
      assert.ok(Math.hypot(dx, dz) >= 100 - 1e-6, `(${x}, ${z}) is ${Math.hypot(dx, dz).toFixed(1)} cm from ${edge.side} wall`);
    }
  }
  assert.ok(lit > 0, "and there is somewhere to stand");
});

test("'the east wall' of an L is both east-facing walls", () => {
  const scene: Scene = { room: L_ROOM, products: [], instances: [] };
  const mask = solve(scene, { product: box }, [{ k: "against", ref: { kind: "wall", id: "w-e" } }]).masks[3]; // yaw 270: back to an east wall
  const xs = new Set<number>();
  for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) if (mask.data[iz * mask.shape[0] + ix] === FREE) xs.add(pointCm(mask, ix, iz)[0]);
  assert.deepEqual([...xs].sort((a, b) => a - b), [175, 180, 375, 380], "flush or within 5 cm of x = 200 in the leg, and of x = 400 in the bar");
});

// The safety net for deleting the rectangle code: on a rectangular floor, walls derived from the floor must give
// exactly what arithmetic on the rectangle gives, for every clause kind that mentions a wall, at every grid point.
const SIDE: Record<string, WallSide> = { "w-n": "n", "w-e": "e", "w-s": "s", "w-w": "w" };
const BACK_TO: Record<WallSide, number> = { n: 0, w: Math.PI / 2, s: Math.PI, e: (3 * Math.PI) / 2 };
test("PROPERTY: on rectangular floors, derived walls equal rectangle arithmetic at every grid point", () => {
  const rooms: Room[] = [fixtures.room as Room, { ...prepared, spatial: cgArchSpatial as Room["spatial"] }];
  const rng = seeded(20260920);
  let compared = 0, lit = 0;
  for (let round = 0; round < 24; round++) {
    const room = rooms[round % rooms.length], floor = wallBounds(room);
    const product: Product = { ...box, widthCm: rng.int(6, 30) * 5 + rng.pick([0, 1, 2.5]), depthCm: rng.int(6, 20) * 5 + rng.pick([0, 1]) };
    const id = rng.pick(Object.keys(SIDE)), cm = rng.pick([30, 60.96, 91.44, 121.92, 152.4]);
    const clause: PlaceClause = rng.pick<PlaceClause>([
      { k: "distance_min", ref: { kind: "any_wall" }, mm: cm * 10 }, { k: "distance_min", ref: { kind: "wall", id }, mm: cm * 10 },
      { k: "clear", ref: { kind: "wall", id }, mm: cm * 10 }, { k: "near", ref: { kind: "wall", id }, mm: cm * 10 },
      { k: "near", ref: { kind: "wall", id } }, { k: "against", ref: { kind: "wall", id } }, { k: "against", ref: { kind: "any_wall" } },
    ]);
    const scene: Scene = { room, products: [], instances: [] };
    const solved = solve(scene, { product }, [clause]);
    assert.deepEqual(solved.dropped, []);
    YAW_BINS.forEach((yawRad, turn) => {
      const legal = invariantMask(scene, { product }, yawRad), mask = solved.masks[turn];
      for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
        const [xCm, zCm] = pointCm(mask, ix, iz), f = footprintRect(product, { xCm, zCm, yawRad });
        const gapTo: Record<WallSide, number> = { n: f.minZ - floor.minZ, s: floor.maxZ - f.maxZ, w: f.minX - floor.minX, e: floor.maxX - f.maxX };
        const named = "id" in clause.ref && clause.ref.id ? [SIDE[clause.ref.id]] : (Object.keys(gapTo) as WallSide[]);
        const distance = "mm" in clause && clause.mm !== undefined ? clause.mm / 10 : undefined;
        const holds = clause.k === "distance_min" || clause.k === "clear" ? named.every((s) => gapTo[s] >= distance! - 1e-6)
          : clause.k === "near" ? named.some((s) => gapTo[s] <= (distance ?? 75) + 1e-6)
          : named.some((s) => gapTo[s] <= 5 + 1e-6 && Math.abs(Math.sin((yawRad - BACK_TO[s]) / 2)) < 1e-6);
        const expected = legal.data[iz * mask.shape[0] + ix] === FREE && holds;
        compared++; lit += expected ? 1 : 0;
        if ((mask.data[iz * mask.shape[0] + ix] === FREE) !== expected)
          assert.fail(`round ${round} ${JSON.stringify(clause)} yaw ${turn} at (${xCm}, ${zCm}): solver ${mask.data[iz * mask.shape[0] + ix]}, arithmetic says ${expected}`);
      }
    });
  }
  assert.ok(compared > 1_000_000 && lit > 10_000, `compared ${compared}, lit ${lit}`);
});
