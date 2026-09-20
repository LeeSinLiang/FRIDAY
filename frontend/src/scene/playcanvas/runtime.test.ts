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
  const internalCamera = {};
  const camera = { camera: internalCamera };
  const sorter = { jobsInFlight: 0, pendingSorted: null as unknown };
  const manager = { cpuSorter: sorter, renderer: { usesGpuSort: true }, sortNeeded: false };
  const runtime = { disposed: false, signal: controller.signal, camera: { camera }, app: {
    systems: { gsplat: splats }, once: frames.once.bind(frames), renderNextFrame: false,
    renderer: { gsplatDirector: { camerasMap: new Map([[internalCamera, { layersMap: new Map([[null, { gsplatManager: manager }]]) }]]) } },
  } } as unknown as PlayCanvasRuntime;
  return { frames, splats, controller, camera, runtime, manager, sorter };
}

test("CPU capture drains stale camera work and waits for the forced latest sort to be applied", async () => {
  const { frames, splats, camera, runtime, manager, sorter } = readinessFixture();
  manager.renderer.usesGpuSort = false;
  sorter.jobsInFlight = 1;
  let settled = false;
  const ready = waitForSplatFrame(runtime, 1000).then(() => { settled = true; });
  const frame = () => { splats.fire("frame:ready", camera, null, true, 0); frames.fire("frameend"); };
  frame();
  assert.equal(manager.sortNeeded, false, "do not enqueue a request the busy engine will drop");
  sorter.jobsInFlight = 0;
  sorter.pendingSorted = {};
  frame();
  assert.equal(manager.sortNeeded, false, "worker message has not yet been applied");
  sorter.pendingSorted = null;
  frame();
  assert.equal(manager.sortNeeded, true, "force the current pose after the stale result drains");
  frame();
  await Promise.resolve();
  assert.equal(settled, false, "request must actually be consumed by the engine");
  manager.sortNeeded = false;
  sorter.jobsInFlight = 1;
  frame();
  sorter.jobsInFlight = 0;
  sorter.pendingSorted = {};
  frame();
  await Promise.resolve();
  assert.equal(settled, false);
  sorter.pendingSorted = null;
  splats.fire("frame:ready", camera, null, true, 0);
  assert.equal(manager.sortNeeded, false, "do not trigger an endless re-sort cycle");
  await Promise.resolve();
  assert.equal(settled, false, "applied order still needs a draw");
  frames.fire("frameend");
  await ready;
  assert.equal(settled, true);
});

test("a changed private engine adapter fails closed instead of returning a stale capture", async () => {
  const { splats, frames, camera, runtime } = readinessFixture();
  Object.assign(runtime.app, { renderer: {} });
  const ready = waitForSplatFrame(runtime, 10);
  splats.fire("frame:ready", camera, null, true, 0);
  frames.fire("frameend");
  await assert.rejects(ready, /did not finish sorting/);
  assert.equal(splats.hasEvent("frame:ready"), false);
});

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
