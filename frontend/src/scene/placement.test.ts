import assert from "node:assert/strict";
import test from "node:test";
import { findOpenPose, validatePlacement } from "./placement";
import type { Instance, Pose, Product, Room } from "./types";
const room: Room = { roomId: "room", revision: 1, widthCm: 600, depthCm: 500, heightCm: 280 };
const sofa: Product = { productId: "sofa", name: "Curve sofa", widthCm: 200, depthCm: 50, heightCm: 80, color: "red", kind: "sofa" };
const pose: Pose = { xCm: 200, zCm: 200, yawRad: 0 };
const item: Instance = { instanceId: "one", productId: "sofa", pose };
const check = (next: Pose, others: Instance[] = []) => validatePlacement(room, [sofa], [item, ...others], item.instanceId, next);

test("rotated footprint respects room edges and height, touching boundaries allowed", () => {
  assert.equal(check({ xCm: 100, zCm: 25, yawRad: 0 }).valid, true);
  assert.equal(check({ xCm: 25, zCm: 100, yawRad: Math.PI / 2 }).valid, true);
  assert.equal(check({ xCm: 24.99, zCm: 100, yawRad: Math.PI / 2 }).reason, "Outside room");
  assert.equal(check({ xCm: 80, zCm: 80, yawRad: Math.PI / 4 }).valid, false);
  assert.equal(validatePlacement(room, [{ ...sofa, heightCm: 281 }], [item], "one", pose).reason, "Too tall for this room");
});

test("SAT detects overlap, excludes self, and permits touching edges", () => {
  assert.equal(check(pose).reason, "Ready to place");
  const other = { ...item, instanceId: "two", pose: { ...pose, xCm: 400 } };
  assert.equal(check(pose, [other]).valid, true);
  const result = check(pose, [{ ...other, pose: { ...other.pose, xCm: 399 } }]);
  assert.equal(result.reason, "Overlaps Curve sofa");
  assert.deepEqual(result.collidingIds, ["two"]);
});

test("parallel rotated rectangles with overlapping AABBs are not falsely blocked", () => {
  const diagonal = { ...pose, yawRad: Math.PI / 4 };
  // Offset perpendicular to the long axis by 60 cm (> 50 cm combined half-depths).
  const other = { ...item, instanceId: "two", pose: { ...diagonal, xCm: 200 + 60 / Math.sqrt(2), zCm: 200 + 60 / Math.sqrt(2) } };
  assert.equal(check(diagonal, [other]).valid, true);
  assert.equal(check(diagonal, [{ ...other, pose: { ...diagonal, xCm: 210, zCm: 210 } }]).valid, false);
});

test("nonfinite poses, malformed dimensions and ambiguous identities fail closed", () => {
  for (const key of ["xCm", "zCm", "yawRad"] as const) assert.equal(check({ ...pose, [key]: NaN }).valid, false);
  assert.equal(validatePlacement(room, [{ ...sofa, depthCm: 0 }], [item], "one", pose).valid, false);
  assert.equal(validatePlacement({ ...room, widthCm: Infinity }, [sofa], [item], "one", pose).valid, false);
  assert.equal(validatePlacement(room, [sofa], [item, item], "one", pose).valid, false);
  assert.equal(validatePlacement(room, [sofa], [], "one", pose).valid, false);
  assert.equal(check(pose, [{ ...item, instanceId: "two", productId: "missing" }]).valid, false);
});

test("nearest free slot is deterministic and respects configured grid at 5 and 10 cm", () => {
  for (const step of [5, 10]) {
    const found = findOpenPose(room, [sofa], [item], sofa, pose, step);
    assert.ok(found);
    assert.equal(found.xCm % step, 0);
    assert.equal(found.zCm % step, 0);
    assert.equal(check(found, [{ ...item, instanceId: "two" }]).valid, true);
    assert.deepEqual(found, findOpenPose(room, [sofa], [item], sofa, pose, step));
  }
});

test("full room, too large model, invalid step yield no placement; tiny steps stay bounded", () => {
  const snug = { ...room, widthCm: sofa.widthCm, depthCm: sofa.depthCm };
  const centered = { xCm: 100, zCm: 25, yawRad: 0 };
  const occupied = [{ ...item, pose: centered }];
  assert.equal(findOpenPose(snug, [sofa], occupied, sofa, centered, 5), null);
  assert.equal(findOpenPose({ ...snug, widthCm: 100 }, [sofa], [], sofa, centered, 5), null);
  assert.equal(findOpenPose(room, [sofa], [], sofa, pose, 0), null);
  const found = findOpenPose(room, [sofa], [item], sofa, pose, 0.00001);
  assert.ok(found);
});

const scannedRoom = (): Room => ({ ...room,
  scan: { geometryRevision: "fixed-v1", calibration: { status: "synthetic_demo", note: "Unmeasured test fixture" },
    visualUrl: "/room.sog", positionCm: [0, 0, 0], rotationDeg: [0, 0, 0], scale: 1,
    defaultCamera: { kind: "firstPerson", xCm: 300, yCm: 160, zCm: 300, yawRad: 0, pitchRad: 0, fovDeg: 60 },
    attribution: { title: "Fixture", author: "Test", url: "", license: "CC0", licenseUrl: "" } },
  spatial: { freeAreas: [{ minXcm: 50, maxXcm: 550, minZcm: 50, maxZcm: 450 }], obstacles: [] },
});

test("scanned room requires reviewed floor and rejects unconfirmed scale with explicit codes", () => {
  const scan = scannedRoom();
  const accepted = validatePlacement(scan, [sofa], [item], "one", pose);
  assert.equal(accepted.valid, true);
  assert.equal(accepted.assurance, "synthetic_demo");
  assert.equal(accepted.reason, "Fits in synthetic demo");
  assert.equal(validatePlacement(scan, [sofa], [item], "one", { ...pose, xCm: 120 }).code, "unknown_area");
  scan.spatial!.freeAreas = [];
  assert.equal(validatePlacement(scan, [sofa], [item], "one", pose).code, "unknown_area");
  scan.scan!.calibration.status = "unconfirmed";
  assert.equal(validatePlacement(scan, [sofa], [item], "one", pose).code, "scale_unconfirmed");
  assert.equal(findOpenPose(scan, [sofa], [], sofa, pose, 5), null);
  scan.scan!.calibration.status = "confirmed";
  scan.spatial!.freeAreas = [{ minXcm: 0, maxXcm: NaN, minZcm: 0, maxZcm: 500 }];
  assert.equal(validatePlacement(scan, [sofa], [item], "one", pose).code, "unknown_area");
});

test("fixed scanned furniture blocks placement with SAT while touching/separated footprints are accepted", () => {
  const scan = scannedRoom();
  scan.spatial!.obstacles = [{ obstacleId: "fixed-sofa", label: "scanned sofa", xCm: 200, zCm: 200, widthCm: 200, depthCm: 50, yawRad: Math.PI / 4 }];
  const diagonal = { ...pose, yawRad: Math.PI / 4 };
  const collision = validatePlacement(scan, [sofa], [item], "one", diagonal);
  assert.equal(collision.code, "fixed_obstacle");
  assert.deepEqual(collision.collidingIds, ["fixed-sofa"]);
  const separated = { ...diagonal, xCm: 200 + 60 / Math.sqrt(2), zCm: 200 + 60 / Math.sqrt(2) };
  assert.equal(validatePlacement(scan, [sofa], [item], "one", separated).valid, true);
});

test("reviewed rectangle union covers the whole rotated footprint without accepting internal unknown gaps", () => {
  const scan = scannedRoom();
  const diagonal = { ...pose, yawRad: Math.PI / 4 };
  scan.spatial!.freeAreas = [{ minXcm: 0, maxXcm: 200, minZcm: 0, maxZcm: 500 }, { minXcm: 200, maxXcm: 600, minZcm: 0, maxZcm: 500 }];
  assert.equal(validatePlacement(scan, [sofa], [item], "one", diagonal).valid, true);
  scan.spatial!.freeAreas[1].minXcm = 201;
  assert.equal(validatePlacement(scan, [sofa], [item], "one", diagonal).code, "unknown_area");
  scan.spatial!.freeAreas = [
    { minXcm: 0, maxXcm: 190, minZcm: 0, maxZcm: 500 },
    { minXcm: 210, maxXcm: 600, minZcm: 0, maxZcm: 500 },
    { minXcm: 190, maxXcm: 210, minZcm: 0, maxZcm: 190 },
    { minXcm: 190, maxXcm: 210, minZcm: 210, maxZcm: 500 },
  ];
  assert.equal(validatePlacement(scan, [sofa], [item], "one", diagonal).code, "unknown_area");
});
