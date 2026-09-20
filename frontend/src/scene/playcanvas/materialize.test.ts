import assert from "node:assert/strict";
import test from "node:test";
import { Entity, StandardMaterial, BoundingBox, Vec3, type MeshInstance, type RenderComponent } from "playcanvas";
import { animateMaterialization, materializeFrame, MATERIALIZE_DURATION_MS } from "./materialize";
import { createGoldenThreads } from "./goldenThreads";

function fixture() {
  const root = new Entity(); root.setLocalPosition(30, 0, 60);
  const child = new Entity(); child.setLocalScale(2, 3, 4); root.addChild(child);
  const original = new StandardMaterial(); original.opacity = 0.7;
  const mesh = { material: original, castShadow: true, aabb: new BoundingBox(new Vec3(0, 1, 0), new Vec3(1, 1, 1)) } as unknown as MeshInstance;
  child.findComponents = () => [{ meshInstances: [mesh] } as unknown as RenderComponent];
  let callback: FrameRequestCallback = () => {};
  const schedule = (next: FrameRequestCallback) => { callback = next; return 42; };
  return { root, child, original, mesh, schedule, tick: (t: number) => callback(t) };
}

test("materialization clamps time and settles precisely", () => {
  assert.equal(materializeFrame(-10).progress, 0);
  const end = materializeFrame(MATERIALIZE_DURATION_MS);
  assert.equal(end.complete, true); assert.equal(end.progress, 1);
  assert.equal(materializeFrame(1e6).progress, 1);
});

test("animation restores authored transforms and shared materials without moving scene pose", () => {
  const f = fixture();
  const stop = animateMaterialization(f.child, () => false, f.schedule, () => {});
  assert.notEqual(f.mesh.material, f.original); assert.equal(f.original.opacity, 0.7);
  f.tick(0); f.tick(400);
  assert.deepEqual(f.child.getLocalScale().toArray(), [2, 3, 4]);
  assert.deepEqual(f.child.getLocalPosition().toArray(), [0, 0, 0]);
  assert.equal((f.mesh.material as StandardMaterial).blendType, f.original.blendType);
  assert.equal((f.mesh.material as StandardMaterial).depthWrite, f.original.depthWrite);
  assert.equal(f.mesh.castShadow, false);
  assert.deepEqual(f.root.getLocalPosition().toArray(), [30, 0, 60]);
  f.tick(MATERIALIZE_DURATION_MS);
  assert.deepEqual(f.child.getLocalScale().toArray(), [2, 3, 4]);
  assert.deepEqual(f.child.getLocalPosition().toArray(), [0, 0, 0]);
  assert.equal(f.mesh.material, f.original); assert.equal(f.mesh.castShadow, true); stop();
});

test("cancellation and reduced motion restore immediately and cannot mutate later", () => {
  const f = fixture(); let reduced = false;
  animateMaterialization(f.child, () => reduced, f.schedule, () => {});
  reduced = true; f.tick(100);
  assert.equal(f.mesh.material, f.original);
  const stop = animateMaterialization(f.child, () => false, f.schedule, () => {});
  stop(); f.tick(300);
  assert.equal(f.mesh.material, f.original);
  assert.deepEqual(f.child.getLocalScale().toArray(), [2, 3, 4]);
  let scheduled = false;
  animateMaterialization(f.child, () => true, () => { scheduled = true; return 0; }, () => {});
  assert.equal(scheduled, false);
});

test("completion advances a sequence only after the actual reveal settles", () => {
  const f = fixture(); let completed = 0;
  animateMaterialization(f.child, () => false, f.schedule, () => {}, () => {
    assert.equal(f.mesh.material, f.original, "the next item starts after authored material is restored");
    completed++;
  });
  f.tick(100); f.tick(100 + MATERIALIZE_DURATION_MS - 1);
  assert.equal(completed, 0);
  f.tick(100 + MATERIALIZE_DURATION_MS);
  assert.equal(completed, 1);
  f.tick(100 + MATERIALIZE_DURATION_MS + 1);
  assert.equal(completed, 1, "late frames cannot advance the sequence twice");
  const stop = animateMaterialization(f.child, () => false, f.schedule, () => {}, () => completed++);
  stop(); f.tick(100 + MATERIALIZE_DURATION_MS * 2);
  assert.equal(completed, 1, "removed or replaced furniture never completes its cancelled reveal");
});

test("reduced motion completes immediately or on the next active frame", () => {
  const f = fixture(); let completed = 0; let reduced = false;
  animateMaterialization(f.child, () => true, f.schedule, () => {}, () => completed++);
  assert.equal(completed, 1);
  animateMaterialization(f.child, () => reduced, f.schedule, () => {}, () => completed++);
  f.tick(10); reduced = true; f.tick(20); f.tick(30);
  assert.equal(completed, 2);
  assert.equal(f.mesh.material, f.original);
});

test("golden silk stays anchored to off-centre furniture, reuses buffers and leaves no settled strands", () => {
  const mesh = { aabb: new BoundingBox(new Vec3(30, 5, -70), new Vec3(2, 3, 4)) } as MeshInstance;
  const calls: { points: Vec3[]; colors: { a: number }[]; depthTest: boolean }[] = [];
  const parent = { findComponent: () => ({ system: { app: {
    drawLines: (points: Vec3[], colors: { a: number }[], depthTest: boolean) => calls.push({ points, colors, depthTest }),
  } } }) } as unknown as Entity;
  const threads = createGoldenThreads(parent, [mesh]);
  assert.ok(threads);
  threads.update(0);
  assert.equal(calls.length, 0);
  threads.update(0.5);
  const first = calls[0];
  assert.equal(first.points.length, 384);
  assert.equal(first.depthTest, true, "strands must not draw over foreground furniture");
  assert.ok(first.colors.some(color => color.a > 0.3));
  assert.ok(first.points.every(point => point.x > 25 && point.x < 35 && point.z > -80 && point.z < -60));
  assert.ok(first.points.every(point => point.y >= 2 && point.y < 12), "strands rise from this object's floor, not the world origin");
  threads.update(0.65);
  assert.equal(calls[1].points, first.points);
  assert.equal(calls[1].colors, first.colors);
  threads.update(1);
  assert.equal(calls.length, 2, "settled furniture has no persistent filament overlay");
  threads.dispose();
  threads.update(0.5);
  assert.equal(calls.length, 2, "disposed effects cannot enqueue more geometry");
});
