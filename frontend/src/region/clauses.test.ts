import assert from "node:assert/strict";
import test from "node:test";
import type { PlaceClause, Ref } from "../lib/dsl/schema";
import { findOpenPose, validatePlacement } from "../scene/placement";
import type { Instance, Pose, Product, Room } from "../scene/types";
import { ALLOW_STACKING, NEAR_DEFAULT_CM, WINDOW_SILL_CM } from "./clauses";
import { countFree, footprintRect, intersect, pointCm, union } from "./grid";
import { invariantMask } from "./invariants";
import { seeded, type Rng } from "./rng";
import { solve } from "./solve";
import { FREE, YAW_BINS, type Mask, type Opening, type Rect, type Scene } from "./types";

const room: Room = { roomId: "room", revision: 1, widthCm: 600, depthCm: 500, heightCm: 280 };
const chair: Product = { productId: "chair", name: "Chair", widthCm: 70, depthCm: 80, heightCm: 100, color: "#a98458", kind: "chair" };
const sofa: Product = { productId: "sofa", name: "Sofa", widthCm: 220, depthCm: 95, heightCm: 74, color: "#b9542c", kind: "sofa" };
const lowTable: Product = { productId: "low", name: "Low table", widthCm: 100, depthCm: 60, heightCm: 40, color: "#d9c8ad", kind: "table" };
const door: Opening = { id: "d1", kind: "door", wall: "w", startCm: 60, widthCm: 90 };
const window1: Opening = { id: "w1", kind: "window", wall: "n", startCm: 200, widthCm: 160 };
const sofaAt: Instance = { instanceId: "sofa-1", productId: "sofa", pose: { xCm: 300, zCm: 400, yawRad: 0 } };
const furnished: Scene = { room, products: [sofa, chair, lowTable], instances: [sofaAt], openings: [door, window1] };
const bare: Scene = { room, products: [chair], instances: [] };

const ANY: Ref = { kind: "any_wall" };
const wall = (id: string): Ref => ({ kind: "wall", id });
const NORTH = 0, WEST = 1, SOUTH = 2, EAST = 3; // YAW_BINS index with the item's back to that wall

function lit(mask: Mask): { pose: Pose; rect: Rect }[] {
  const out: { pose: Pose; rect: Rect }[] = [];
  for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
    if (mask.data[iz * mask.shape[0] + ix] !== FREE) continue;
    const [xCm, zCm] = pointCm(mask, ix, iz);
    out.push({ pose: { xCm, zCm, yawRad: mask.yawRad }, rect: footprintRect(chair, { xCm, zCm, yawRad: mask.yawRad }) });
  }
  return out;
}
const sameData = (a: Mask, b: Mask) => assert.deepEqual([...a.data], [...b.data]);

test("no clauses: the solution is exactly the invariant masks, one per quarter turn", () => {
  const solution = solve(furnished, { product: chair }, []);
  assert.equal(solution.masks.length, 4);
  assert.deepEqual(solution.dropped, []);
  const noDoor: Scene = { ...furnished, openings: [window1] };
  solve(noDoor, { product: chair }, []).masks.forEach((mask, i) => sameData(mask, invariantMask(noDoor, { product: chair }, YAW_BINS[i])));
});

test("distance_min(any_wall) is measured from the item's edge, in mm, to EVERY wall", () => {
  const { masks } = solve(bare, { product: chair }, [{ k: "distance_min", ref: ANY, mm: 1524 }]);
  const points = lit(masks[NORTH]);
  assert.ok(points.length > 0);
  for (const { rect } of points)
    assert.ok(rect.minX >= 152.4 && rect.minZ >= 152.4 && 600 - rect.maxX >= 152.4 && 500 - rect.maxZ >= 152.4);
  // Tight: the first legal centre is the first grid point at or past 152.4 + 35.
  assert.equal(Math.min(...points.map((p) => p.pose.xCm)), 190);
});

test("a per-wall exception survives: 914 mm from three walls, 610 mm from the west", () => {
  const place: PlaceClause[] = [["w-n", 914], ["w-e", 914], ["w-s", 914], ["w-w", 610]]
    .map(([id, mm]) => ({ k: "distance_min", ref: wall(id as string), mm: mm as number }));
  const points = lit(solve(bare, { product: chair }, place).masks[NORTH]);
  assert.equal(Math.min(...points.map((p) => p.rect.minX)), 65); // first grid point past 61: centre 100, edge 65
  assert.equal(Math.min(...points.map((p) => p.rect.minZ)), 95); // past 91.4: centre 135, edge 95
  assert.ok(points.every((p) => 600 - p.rect.maxX >= 91.4));
});

test("near: SOME one target within reach; default distance when none is given", () => {
  const nearWindow = lit(solve(furnished, { product: chair }, [{ k: "near", ref: { kind: "window", id: "w1" } }]).masks[NORTH]);
  assert.ok(nearWindow.length > 0 && nearWindow.every((p) => p.rect.minZ <= NEAR_DEFAULT_CM));
  assert.ok(nearWindow.every((p) => p.rect.maxX >= 200 - NEAR_DEFAULT_CM && p.rect.minX <= 360 + NEAR_DEFAULT_CM));
  const within30 = lit(solve(furnished, { product: chair }, [{ k: "near", ref: { kind: "window" }, mm: 300 }]).masks[NORTH]);
  assert.ok(within30.length > 0 && within30.length < nearWindow.length && within30.every((p) => p.rect.minZ <= 30));
});

test("any_wall: near and against UNION the walls, distance_min and clear INTERSECT them", () => {
  const each = (k: "near" | "distance_min") => ["w-n", "w-e", "w-s", "w-w"].map((id) =>
    solve(bare, { product: chair }, [{ k, ref: wall(id), mm: 400 }]).masks[NORTH]);
  sameData(solve(bare, { product: chair }, [{ k: "near", ref: ANY, mm: 400 }]).masks[NORTH], each("near").reduce(union));
  sameData(solve(bare, { product: chair }, [{ k: "distance_min", ref: ANY, mm: 400 }]).masks[NORTH], each("distance_min").reduce(intersect));
  // The impossible AND that compile() refuses to emit really is empty: near the north AND south walls.
  const both: PlaceClause[] = [{ k: "near", ref: wall("w-n"), mm: 400 }, { k: "near", ref: wall("w-s"), mm: 400 }];
  assert.deepEqual(solve(bare, { product: chair }, both).legalCounts, [0, 0, 0, 0]);
});

test("against fixes the rotation: back to the wall, within the grid tolerance", () => {
  const north = solve(bare, { product: chair }, [{ k: "against", ref: wall("w-n") }]);
  assert.deepEqual(north.legalCounts.map((n) => n > 0), [true, false, false, false]);
  assert.ok(lit(north.masks[NORTH]).every((p) => p.rect.minZ <= 5));
  assert.equal(north.bestYawIndex, NORTH);
  const any = solve(bare, { product: chair }, [{ k: "against", ref: ANY }]);
  assert.ok(any.legalCounts.every((n) => n > 0));
  assert.ok(lit(any.masks[WEST]).every((p) => p.rect.minX <= 5));
  assert.ok(lit(any.masks[SOUTH]).every((p) => 500 - p.rect.maxZ <= 5));
  assert.ok(lit(any.masks[EAST]).every((p) => 600 - p.rect.maxX <= 5));
  // "On the wall" (a mirror, a shelf) is the same thing on the floor plan.
  sameData(solve(bare, { product: chair }, [{ k: "on", ref: wall("w-n") }]).masks[NORTH], north.masks[NORTH]);
});

test("door: its swing is always kept free, and clear(door) widens that zone", () => {
  const inSwing = (p: { rect: Rect }, depth: number) => p.rect.minX < depth && p.rect.minZ < 150 && p.rect.maxZ > 60;
  const always = lit(solve(furnished, { product: chair }, []).masks[NORTH]);
  assert.ok(always.every((p) => !inSwing(p, 90)) && always.some((p) => inSwing(p, 200)));
  const clear2m = lit(solve(furnished, { product: chair }, [{ k: "clear", ref: { kind: "door", id: "d1" }, mm: 2000 }]).masks[NORTH]);
  assert.ok(clear2m.length > 0 && clear2m.every((p) => !inSwing(p, 200)));
  sameData(solve(furnished, { product: chair }, [{ k: "not_blocking", ref: { kind: "door" } }]).masks[NORTH],
    solve(furnished, { product: chair }, []).masks[NORTH]);
});

test("clear(wall) equals distance_min(wall); not_blocking(instance) leaves room to walk up", () => {
  sameData(solve(bare, { product: chair }, [{ k: "clear", ref: ANY, mm: 750 }]).masks[NORTH],
    solve(bare, { product: chair }, [{ k: "distance_min", ref: ANY, mm: 750 }]).masks[NORTH]);
  const points = lit(solve(furnished, { product: chair }, [{ k: "not_blocking", ref: { kind: "instance", id: "sofa-1" } }]).masks[NORTH]);
  const sofaRect = footprintRect(sofa, sofaAt.pose);
  assert.ok(points.every((p) => Math.hypot(Math.max(0, sofaRect.minX - p.rect.maxX, p.rect.minX - sofaRect.maxX),
    Math.max(0, sofaRect.minZ - p.rect.maxZ, p.rect.minZ - sofaRect.maxZ)) >= 60 - 1e-6));
});

test("not_blocking(window): only items taller than the assumed sill block it", () => {
  const place: PlaceClause[] = [{ k: "not_blocking", ref: { kind: "window", id: "w1" } }];
  assert.ok(chair.heightCm > WINDOW_SILL_CM && lowTable.heightCm <= WINDOW_SILL_CM);
  const tall = solve(furnished, { product: chair }, place), free = solve(furnished, { product: chair }, []);
  assert.ok(countFree(tall.masks[NORTH]) < countFree(free.masks[NORTH]));
  assert.ok(lit(tall.masks[NORTH]).every((p) => !(p.rect.minZ < 50 && p.rect.maxX > 200 && p.rect.minX < 360)));
  sameData(solve(furnished, { product: lowTable }, place).masks[NORTH], solve(furnished, { product: lowTable }, []).masks[NORTH]);
});

test("clauses that cannot be honoured are dropped WITH a reason, and the rest still solve", () => {
  const place: PlaceClause[] = [
    { k: "near", ref: { kind: "window", id: "w1" } },
    { k: "distance_min", ref: ANY, mm: 500 },
    { k: "against", ref: wall("w-up") },
    { k: "near", ref: { kind: "instance", id: "ghost" } },
    { k: "on", ref: { kind: "instance", id: "sofa-1" } },
    { k: "not_blocking", ref: ANY },
  ];
  const noOpenings: Scene = { ...furnished, openings: undefined };
  const solution = solve(noOpenings, { product: chair }, place);
  assert.deepEqual(solution.dropped.map((d) => [d.clause.k, d.reason]), [
    ["near", "the room does not describe its windows yet"],
    ["against", 'the room has no wall "w-up"'],
    ["near", 'nothing called "ghost" is in the room'],
    ["on", "the editor cannot place one item on another yet, so this would light floor the drop then refuses"],
    ["not_blocking", "a wall cannot be blocked"],
  ]);
  sameData(solution.masks[NORTH], solve(noOpenings, { product: chair }, [{ k: "distance_min", ref: ANY, mm: 500 }]).masks[NORTH]);
  assert.equal(ALLOW_STACKING, false);
  assert.deepEqual(solve(furnished, { product: chair }, [{ k: "near", ref: { kind: "door", id: "d9" } }]).dropped.map((d) => d.reason),
    ['the room has no door "d9"']);
});

function randomPlace(rng: Rng): PlaceClause[] {
  const refs: Ref[] = [ANY, wall("w-n"), wall("w-e"), wall("w-s"), wall("w-w"), { kind: "window" }, { kind: "door", id: "d1" },
    { kind: "instance", id: "i1" }, { kind: "instance", id: "i2" }];
  const kinds: PlaceClause["k"][] = ["near", "against", "distance_min", "clear", "on", "not_blocking"];
  return Array.from({ length: rng.int(0, 3) }, () => {
    const k = rng.pick(kinds), ref = rng.pick(refs), mm = rng.int(1, 30) * 50;
    return (k === "distance_min" || k === "clear" ? { k, ref, mm } : k === "near" && rng.next() < 0.5 ? { k, ref, mm } : { k, ref }) as PlaceClause;
  });
}

function randomScene(rng: Rng): Scene {
  const scene: Scene = { room: { ...room, widthCm: rng.int(60, 140) * 5, depthCm: rng.int(60, 120) * 5 }, products: [chair], instances: [],
    openings: rng.next() < 0.7 ? [{ ...door, startCm: rng.int(0, 30) * 5 }, { ...window1, startCm: rng.int(0, 20) * 5, widthCm: 100 }] : undefined };
  for (let n = 1; n <= rng.int(0, 3); n++) {
    const product: Product = { ...lowTable, productId: `p${n}`, widthCm: rng.int(6, 40) * 5, depthCm: rng.int(6, 24) * 5 };
    scene.products.push(product);
    const pose = findOpenPose(scene.room, scene.products, scene.instances, product,
      { xCm: rng.int(0, scene.room.widthCm), zCm: rng.int(0, scene.room.depthCm), yawRad: rng.pick(YAW_BINS) }, 5);
    if (pose) scene.instances.push({ instanceId: `i${n}`, productId: product.productId, pose });
  }
  return scene;
}

test("PROPERTY: every point the solver lights passes the editor's placement check, and clauses only ever narrow", () => {
  let litPoints = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = seeded(seed), scene = randomScene(rng), place = randomPlace(rng);
    const solution = solve(scene, { product: chair }, place);
    solution.masks.forEach((mask, i) => {
      const open = invariantMask(scene, { product: chair }, YAW_BINS[i]);
      for (let n = 0; n < mask.data.length; n++) if (mask.data[n] === FREE) assert.equal(open.data[n], FREE, `seed ${seed}: a clause lit a new point`);
      for (const { pose } of lit(mask)) {
        const instances = [...scene.instances, { instanceId: "__probe__", productId: chair.productId, pose }];
        assert.equal(validatePlacement(scene.room, scene.products, instances, "__probe__", pose).valid, true,
          `seed ${seed}: lit ${pose.xCm},${pose.zCm} yaw ${pose.yawRad} is refused by the editor`);
        litPoints++;
      }
    });
    assert.equal(solution.dropped.length + 0 <= place.length, true);
  }
  assert.ok(litPoints > 100000, `only ${litPoints} lit points were checked`);
});
