import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import type { Listing } from "../lib/types";
import { listingToProduct } from "../region/boundary";
import { resolveLiveSupport } from "../catalogue/liveSupport";
import { solve } from "../region/solve";
import { supportHeightCm, validatePlacement } from "./placement";
import type { Instance, Pose, Room } from "./types";

test("frontend and backend agree on supported catalogue placements", () => {
  const feed = JSON.parse(readFileSync(resolve(process.cwd(), "../backend/catalogue/data/listings.json"), "utf8")) as { items: Listing[] };
  const table = listingToProduct(feed.items.find(item => item.id === "ikea-702.211.42")!);
  const vase = listingToProduct(feed.items.find(item => item.id === "abo-B07B8NVHX1")!);
  assert.equal(table.supportSurface, true);
  assert.equal(vase.supportSurface, undefined, "decor has a table silhouette but cannot support furniture");
  const cases = [
    { xCm: 300, zCm: 250, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 364.6, zCm: 250, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 364.600002, zCm: 250, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 300, zCm: 283.6, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: true },
    { xCm: 300, zCm: 283.600002, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 360, zCm: 250, yawRad: Math.PI / 4, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 363, zCm: 250, yawRad: Math.PI / 4, tableYawRad: 0, roomHeightCm: 280, reverse: false },
    { xCm: 300, zCm: 250, yawRad: 0, tableYawRad: Math.PI / 4, roomHeightCm: 280, reverse: false },
    { xCm: 300, zCm: 250, yawRad: 0, tableYawRad: 0, roomHeightCm: 90, reverse: false },
    { xCm: 100, zCm: 100, yawRad: 0, tableYawRad: 0, roomHeightCm: 280, reverse: false },
  ];
  const front = cases.map(c => {
    const room: Room = { roomId: "comparison", revision: 1, widthCm: 600, depthCm: 500, heightCm: c.roomHeightCm };
    const tablePose: Pose = { xCm: 300, zCm: 250, yawRad: c.tableYawRad };
    const vasePose: Pose = { xCm: c.xCm, zCm: c.zCm, yawRad: c.yawRad };
    const support: Instance = { instanceId: "table-1", productId: table.productId, pose: tablePose };
    const candidate: Instance = { instanceId: "vase-1", productId: vase.productId, pose: vasePose };
    const instances = c.reverse ? [candidate, support] : [support, candidate];
    const valid = validatePlacement(room, [table, vase], instances, candidate.instanceId, vasePose).valid;
    if (c.xCm === 300 && c.zCm === 250 && c.roomHeightCm === 280)
      assert.equal(supportHeightCm(room, [table, vase], instances, candidate.instanceId, vasePose), 74);
    return valid;
  });
  const backend = spawnSync("uv", ["run", "--frozen", "python", "-m", "api.stacking_probe"], {
    cwd: resolve(process.cwd(), "../backend"), input: JSON.stringify(cases), encoding: "utf8",
    env: { ...process.env, OPENAI_API_KEY: "", SEARCH_BACKEND: "memory" },
  });
  assert.ifError(backend.error); // Report a missing runner directly instead of null !== 0.
  assert.equal(backend.status, 0, backend.stderr);
  assert.deepEqual(JSON.parse(backend.stdout), front);
  assert.deepEqual(front, [true, true, false, true, false, true, false, true, false, true]);
});

test("explicit on-table sentence resolves only one live support and leaves floor searches alone", () => {
  const table = { id: "placed-table", name: "LISABO dining table" };
  const query = "Stone and Beam vase on the table";
  assert.deepEqual(resolveLiveSupport(query, [], [table]), [{ k: "on", ref: { kind: "instance", id: table.id } }]);
  assert.deepEqual(resolveLiveSupport(query, [], []), [{ k: "on", ref: { kind: "instance", id: "__unresolved_support__" } }]);
  assert.deepEqual(resolveLiveSupport(query, [], [table, { id: "other", name: "Another table" }]),
    [{ k: "on", ref: { kind: "instance", id: "__unresolved_support__" } }]);
  const floor = [{ k: "near" as const, ref: { kind: "wall" as const, id: "w-n" } }];
  assert.deepEqual(resolveLiveSupport("a vase", floor, [table]), floor);
  const vase = { productId: "vase", name: "Vase", widthCm: 10, depthCm: 10, heightCm: 20,
    color: "#fff", kind: "table" as const };
  const empty = { room: { roomId: "room", revision: 1, widthCm: 300, depthCm: 300, heightCm: 250 },
    products: [vase], instances: [] };
  assert.deepEqual(solve(empty, { product: vase }, resolveLiveSupport(query, [], [])).legalCounts, [0, 0, 0, 0]);
});
