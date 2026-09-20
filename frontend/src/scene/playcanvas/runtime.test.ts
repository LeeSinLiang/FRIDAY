import assert from "node:assert/strict";
import test from "node:test";
import { Entity, EventHandler } from "playcanvas";
import type { Room } from "../types";
import { createPlayCanvasRuntime, setFirstPersonCamera, waitForSplatFrame, type PlayCanvasRuntime } from "./runtime";

test("invalid room creation reports synchronously to its effect owner", () => {
  assert.throws(() => createPlayCanvasRuntime({} as HTMLCanvasElement, { room: { roomId: "no-scan" } as Room }), /prepared room scan/);
});

test("first-person camera converts physical coordinates once and keeps the yaw convention", () => {
  const camera = new Entity("Test camera");
  setFirstPersonCamera(camera, { kind: "firstPerson", xCm: 250, yCm: 160, zCm: 300, yawRad: Math.PI / 2, pitchRad: 0, fovDeg: 60 });
  assert.deepEqual(camera.getPosition().toArray(), [50, 32, 60]);
  assert.ok(Math.abs(camera.forward.x + 1) < 1e-6);
  assert.ok(Math.abs(camera.forward.y) < 1e-6);
  assert.ok(Math.abs(camera.forward.z) < 1e-6);
});

function readinessFixture() {
  const frames = new EventHandler();
  const splats = new EventHandler();
  const controller = new AbortController();
  const camera = {};
  const runtime = { disposed: false, signal: controller.signal, camera: { camera }, app: {
    systems: { gsplat: splats }, once: frames.once.bind(frames), renderNextFrame: false,
  } } as unknown as PlayCanvasRuntime;
  return { frames, splats, controller, camera, runtime };
}

test("capture readiness requires the matching camera, current sorting, no loading and frame end", async () => {
  const { frames, splats, camera, runtime } = readinessFixture();
  let settled = false;
  const ready = waitForSplatFrame(runtime, 1000).then(() => { settled = true; });
  assert.equal(runtime.app.renderNextFrame, true);
  splats.fire("frame:ready", {}, null, true, 0);
  frames.fire("frameend");
  splats.fire("frame:ready", camera, null, false, 0);
  frames.fire("frameend");
  splats.fire("frame:ready", camera, null, true, 1);
  frames.fire("frameend");
  await Promise.resolve();
  assert.equal(settled, false);
  splats.fire("frame:ready", camera, null, true, 0);
  await Promise.resolve();
  assert.equal(settled, false);
  frames.fire("frameend");
  await ready;
  assert.equal(settled, true);
  assert.equal(splats.hasEvent("frame:ready"), false);
  assert.equal(frames.hasEvent("frameend"), false);
});

test("disposing the renderer or cancelling a capture removes all readiness listeners", async () => {
  for (const external of [false, true]) {
    const { frames, splats, controller, camera, runtime } = readinessFixture();
    const capture = new AbortController();
    const ready = waitForSplatFrame(runtime, 1000, capture.signal);
    splats.fire("frame:ready", camera, null, true, 0);
    (external ? capture : controller).abort();
    await assert.rejects(ready, /cancelled/);
    assert.equal(splats.hasEvent("frame:ready"), false);
    assert.equal(frames.hasEvent("frameend"), false);
  }
});

test("mesh readiness completes after frame end without waiting for a splat sort", async () => {
  const { frames, runtime } = readinessFixture();
  runtime.room = { scan: { visualFormat: "glb" } } as Room;
  let settled = false;
  const ready = waitForSplatFrame(runtime, 1000).then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  frames.fire("frameend");
  await ready;
  assert.equal(settled, true);
});
