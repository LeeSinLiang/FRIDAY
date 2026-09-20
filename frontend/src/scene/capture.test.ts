import assert from "node:assert/strict";
import test from "node:test";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { buildCaptureCamera } from "./captureCamera";
import { captureCompletionPayload, parseCaptureJob } from "./useCaptureWorker";
import { PRODUCTS, ROOM } from "./fixtures";

test("capture perspective frames all room bounds across angles, aspect ratios and physical scales", () => {
  for (const scale of [5, 10]) for (const [width, height] of [[1024, 768], [768, 1024], [1536, 512]]) {
    for (const azimuthDeg of [0, 37, 90, 180, 270]) for (const elevationDeg of [10, 35, 75]) {
      const camera = buildCaptureCamera(ROOM, "perspective", width, height, { azimuthDeg, elevationDeg }, scale);
      assert.ok(camera instanceof PerspectiveCamera);
      for (const x of [-12, ROOM.widthCm + 12]) for (const y of [-18, ROOM.heightCm]) for (const z of [-12, ROOM.depthCm + 12]) {
        const point = new Vector3(x / scale, y / scale, z / scale).project(camera);
        assert.ok(Math.abs(point.x) <= 0.860001 && Math.abs(point.y) <= 0.860001);
        assert.ok(point.z >= -1 && point.z <= 1);
      }
    }
  }
});

test("capture camera conventions are azimuth0 at +Z and positive azimuth toward +X", () => {
  const front = buildCaptureCamera(ROOM, "perspective", 1024, 768, { azimuthDeg: 0, elevationDeg: 35 }, 5);
  assert.ok(Math.abs(front.position.x - ROOM.widthCm / 10) < 1e-8);
  assert.ok(front.position.z > ROOM.depthCm / 10);
  const side = buildCaptureCamera(ROOM, "perspective", 1024, 768, { azimuthDeg: 90, elevationDeg: 35 }, 5);
  assert.ok(side.position.x > ROOM.widthCm / 10);
  assert.ok(Math.abs(side.position.z - ROOM.depthCm / 10) < 1e-8);
});

test("top capture is orthographic, centered, and invariant under centimeter-to-scene scale", () => {
  const a = buildCaptureCamera(ROOM, "top", 1024, 768, undefined, 5);
  const b = buildCaptureCamera(ROOM, "top", 1024, 768, undefined, 10);
  assert.ok(a instanceof OrthographicCamera);
  assert.ok(b instanceof OrthographicCamera);
  const center = new Vector3(ROOM.widthCm / 10, 0, ROOM.depthCm / 10).project(a);
  assert.ok(Math.abs(center.x) < 1e-8 && Math.abs(center.y) < 1e-8);
  const south = new Vector3(ROOM.widthCm / 10, 0, ROOM.depthCm / 5).project(a);
  assert.ok(south.y < 0);
  assert.equal(a.position.y, b.position.y * 2);
  assert.equal(a.left, b.left * 2);
  assert.throws(() => buildCaptureCamera(ROOM, "perspective", 0, 768));
  assert.throws(() => buildCaptureCamera(ROOM, "perspective", 1024, 768, { azimuthDeg: NaN, elevationDeg: 35 }));
});

test("capture jobs are copied and reject unsafe dimensions, inconsistent revision and unknown models", () => {
  const job = { captureId: "capture-123", leaseToken: "lease", revision: 3, view: "perspective", camera: { azimuthDeg: 37, elevationDeg: 35 }, width: 1024, height: 768,
    snapshot: { room: ROOM, products: PRODUCTS, instances: [{ instanceId: "one", productId: PRODUCTS[0].productId, pose: { xCm: 200, zCm: 200, yawRad: 0 } }], revision: 3 } };
  const parsed = parseCaptureJob(job);
  assert.notEqual(parsed.snapshot, job.snapshot);
  for (const width of [0, 1537, Infinity, 1.5]) assert.throws(() => parseCaptureJob({ ...job, width }));
  assert.throws(() => parseCaptureJob({ ...job, captureId: "../../other" }));
  assert.throws(() => parseCaptureJob({ ...job, revision: 4 }));
  assert.throws(() => parseCaptureJob({ ...job, snapshot: { ...job.snapshot, products: [] } }));
});

test("capture completion always has exactly one terminal result even across stale runtime signatures", () => {
  for (const value of [undefined, null, "old-lease-token", 123, {}, { imageDataUrl: "png", error: { code: "bad", message: "bad" } }]) {
    const payload = captureCompletionPayload("lease", value);
    assert.equal(payload.leaseToken, "lease");
    assert.ok("error" in payload);
    assert.ok(!("imageDataUrl" in payload));
    assert.deepEqual(Object.keys(payload).sort(), ["error", "leaseToken"]);
  }
  assert.deepEqual(captureCompletionPayload("lease", { imageDataUrl: "data:image/png;base64,test", modelWarnings: ["proxy", 12] }), {
    leaseToken: "lease", imageDataUrl: "data:image/png;base64,test", modelWarnings: ["proxy"],
  });
  const bounded = captureCompletionPayload("lease", { error: { code: "x".repeat(200), message: "y".repeat(2000) } });
  assert.equal(bounded.error?.code.length, 100);
  assert.equal(bounded.error?.message.length, 1000);
});

test("frozen capture derives child height and rotation from its reviewed support", () => {
  const instances = [
    {instanceId:'desk',productId:'support-demo-table',pose:{xCm:200,zCm:250,yawRad:Math.PI/2}},
    {instanceId:'lamp',productId:'support-demo-lamp',pose:{xCm:0,zCm:0,yCm:999,yawRad:0},attachment:{
      parentInstanceId:'desk',target:{kind:'surface',id:'top'},profileRevision:'1',localPose:{xCm:25,zCm:0,yawRad:0}}},
  ];
  const parsed=parseCaptureJob({captureId:'capture-support',leaseToken:'lease',revision:1,view:'top',width:960,height:720,
    snapshot:{room:ROOM,products:PRODUCTS,instances,revision:1}});
  assert.equal(parsed.snapshot.instances[1].pose.yCm,75);
  assert.equal(parsed.snapshot.instances[1].pose.xCm,200);
  assert.equal(parsed.snapshot.instances[1].pose.zCm,225);
  assert.equal(parsed.snapshot.instances[1].pose.yawRad,Math.PI/2);
  assert.equal(instances[1].pose.yCm,999);
});
