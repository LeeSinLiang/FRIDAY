import { strict as assert } from "node:assert";
import { test } from "node:test";
import { dragPose, furnitureHit, intersectFloor } from "./interaction";
import { advanceWalk, canWalkAt, movementDelta } from "./navigation";
import { placementTone } from "./overlays";
import { createProxyMaterials } from "./furniture";
import type { Instance, Product, Room } from "../types";
import manifest from "../../../../shared/rooms/studio-11/manifest.json";
import spatial from "../../../../shared/rooms/studio-11/spatial.json";

const room: Room = { roomId: "interaction-test", revision: 1, widthCm: 600, depthCm: 500, heightCm: 280 };
const product: Product = { productId: "test-sofa", name: "Sofa", kind: "sofa", color: "#b96942", widthCm: 200, depthCm: 100, heightCm: 80 };
const instance: Instance = { instanceId: "sofa-1", productId: product.productId, pose: { xCm: 300, zCm: 250, yawRad: 0 } };
const studio: Room = { ...manifest.room, spatial } as Room;
const scanned = { ...room, scan: studio.scan };

test("proxy fabric, seams, wood and stone use finite normalized shader gloss and independent materials", () => {
  const first = createProxyMaterials("#a98458");
  const second = createProxyMaterials("#a98458");
  try {
    for (const material of Object.values(first)) {
      assert.ok(material.gloss >= 0 && material.gloss <= 1);
      assert.ok(Number.isFinite(2 ** (material.gloss * 11)));
      assert.equal(material.metalness, 0);
    }
    assert.equal(first.fabric.diffuse.r, 169 / 255);
    assert.equal(first.fabric.diffuse.g, 132 / 255);
    assert.equal(first.fabric.diffuse.b, 88 / 255);
    assert.notEqual(first.fabric, second.fabric);
    first.fabric.destroy();
    assert.equal(second.fabric.diffuse.r, 169 / 255);
  } finally {
    for (const material of Object.values(first)) if (material !== first.fabric) material.destroy();
    for (const material of Object.values(second)) material.destroy();
  }
});

test("first-person picking intersects rotated furniture bounds and ignores objects behind the camera", () => {
  const ray = { origin: { x: 300, y: 40, z: 490 }, direction: { x: 0, y: 0, z: -1 } };
  assert.equal(furnitureHit(ray, instance, product)?.distance, 190);
  assert.equal(furnitureHit(ray, { ...instance, pose: { ...instance.pose, yawRad: Math.PI / 2 } }, product)?.distance, 140);
  assert.equal(furnitureHit({ ...ray, direction: { x: 0, y: 0, z: 1 } }, instance, product), null);
  assert.equal(furnitureHit({ ...ray, origin: { ...ray.origin, y: 100 } }, instance, product), null);
});

test("floor placement does not use a stale point for a horizontal, upward or excessively distant ray", () => {
  const origin = { x: 200, y: 160, z: 400 };
  assert.equal(intersectFloor({ origin, direction: { x: 0, y: 0, z: -1 } }), null);
  assert.equal(intersectFloor({ origin, direction: { x: 0, y: 1, z: 0 } }), null);
  assert.equal(intersectFloor({ origin, direction: { x: 0, y: -0.001, z: -1 } }), null);
  assert.deepEqual(intersectFloor({ origin, direction: { x: 0, y: -1, z: 0 } }), { x: 200, y: 0, z: 400 });
});

test("dragging preserves the grabbed surface offset before optional grid snapping", () => {
  const point = { x: 243, y: 40, z: 169 };
  assert.deepEqual(dragPose(point, { x: 20, z: -10 }, 0.3, false), { xCm: 223, zCm: 179, yawRad: 0.3 });
  assert.deepEqual(dragPose(point, { x: 20, z: -10 }, 0.3, true), { xCm: 225, zCm: 180, yawRad: 0.3 });
});

test("walking is bounded after a suspended tab and cannot leave the room", () => {
  assert.equal(movementDelta(10), 7.5);
  assert.equal(movementDelta(-1), 0);
  assert.equal(movementDelta(Number.NaN), 0);
  const moved = advanceWalk(room, { xCm: 580, zCm: 200 }, 40, 0);
  assert.ok(moved.xCm <= 580);
  assert.equal(canWalkAt(room, -1, 200), false);
});

test("walking sweeps across thin fixed obstacles and slides along their edge", () => {
  const blocked: Room = { ...scanned, spatial: { freeAreas: [{ minXcm: 0, maxXcm: 600, minZcm: 0, maxZcm: 500 }], obstacles: [{ obstacleId: "wall", label: "wall", xCm: 300, zCm: 250, widthCm: 2, depthCm: 500, yawRad: 0 }] } };
  const next = advanceWalk(blocked, { xCm: 275, zCm: 200 }, 70, 30);
  assert.ok(next.xCm <= 279);
  assert.ok(next.zCm > 200);
  assert.equal(canWalkAt(blocked, 290, 200), false);
});

test("walking respects declared surveyed floor boundaries", () => {
  const restricted: Room = { ...scanned, spatial: { freeAreas: [{ minXcm: 100, maxXcm: 400, minZcm: 100, maxZcm: 400 }], obstacles: [] } };
  assert.equal(canWalkAt(restricted, 200, 200), true);
  assert.equal(canWalkAt(restricted, 105, 200), false);
  assert.equal(canWalkAt(restricted, 500, 200), false);
});

test("Studio 11 walking crosses adjacent reviewed rectangles without an artificial seam", () => {
  for (const x of [372, 375, 390, 405, 408]) assert.equal(canWalkAt(studio, x, 250), true, `seam at ${x}`);
  const next = advanceWalk(studio, { xCm: 372, zCm: 250 }, 36, 0);
  assert.deepEqual(next, { xCm: 408, zCm: 250 });
});

test("walking uses the backend capture's 20 cm square clearance and rejects unreviewed scans", () => {
  assert.equal(canWalkAt(studio, 44, 300), false);
  assert.equal(canWalkAt(studio, 45, 300), true);
  assert.equal(canWalkAt(studio, 250, 80), false);
  assert.equal(canWalkAt({ ...studio, spatial: { freeAreas: [], obstacles: [] } }, 300, 300), false);
  assert.equal(canWalkAt({ ...studio, spatial: undefined }, 300, 300), false);
});

test("reviewed floor union preserves enclosed unknown gaps", () => {
  const gap: Room = { ...scanned, spatial: { freeAreas: [
    { minXcm: 0, maxXcm: 300, minZcm: 0, maxZcm: 500 },
    { minXcm: 302, maxXcm: 600, minZcm: 0, maxZcm: 500 },
  ], obstacles: [] } };
  assert.equal(canWalkAt(gap, 301, 250), false);
});

test("footprint colors distinguish unverified geometry from a definite collision", () => {
  assert.equal(placementTone({ valid: true, reason: "Fits in synthetic demo" }), "green");
  assert.equal(placementTone({ valid: false, reason: "Overlaps fixed sofa" }), "red");
  assert.equal(placementTone({ valid: false, reason: "Unverified area" }), "amber");
  assert.equal(placementTone({ valid: false, reason: "Room scale is unconfirmed" }), "amber");
  assert.equal(placementTone({ valid: false, reason: "Point at the floor to place furniture" }), "amber");
});

import emptyManifest from "../../../../shared/rooms/empty-room/manifest.json";
import emptySpatial from "../../../../shared/rooms/empty-room/spatial.json";
test("authored mesh room walking respects exact interior and closed navigation boundary at doorway", () => {
  const empty = { ...emptyManifest.room, spatial: emptySpatial } as unknown as Room;
  assert.equal(canWalkAt(empty, 300, 430), true);
  assert.equal(canWalkAt(empty, 19, 250), false);
  assert.equal(canWalkAt(empty, 20, 250), true);
  assert.equal(canWalkAt(empty, 300, 481), false);
  const moved = advanceWalk(empty, { xCm: 300, zCm: 470 }, 0, 100);
  assert.ok(moved.zCm <= 480);
});
