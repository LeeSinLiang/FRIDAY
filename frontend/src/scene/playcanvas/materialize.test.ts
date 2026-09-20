import assert from "node:assert/strict";
import test from "node:test";
import { Entity, StandardMaterial, BoundingBox, Vec3, type MeshInstance, type RenderComponent } from "playcanvas";
import { animateMaterialization, materializeFrame, MATERIALIZE_DURATION_MS } from "./materialize";

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
