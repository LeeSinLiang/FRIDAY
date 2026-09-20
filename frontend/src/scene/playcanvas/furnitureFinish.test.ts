import assert from "node:assert/strict";
import test from "node:test";
import { BLEND_NORMAL, Entity, SHADERLANGUAGE_GLSL, StandardMaterial, type MeshInstance, type RenderComponent } from "playcanvas";
import { createFurnitureFinish, furnitureAmbient } from "./furnitureFinish";
import { furnitureLightingProfile } from "./furnitureLightingProfile";
import type { Instance, Product, Room } from "../types";
import { applyFurniturePose } from "./furniture";
import { createFurnitureShadowRefresh } from "./furnitureAppearance";
import { cmToScene } from "../units";
import { PRODUCTS } from "../fixtures";
import { moveWithAttachments, resolveAttachments } from "../supports";

const profile = furnitureLightingProfile({ roomId: "cg-arch-interior" } as Room);
const product = { widthCm: 10.8, depthCm: 10.8, heightCm: 20.3 } as Product;
function fixture(original = new StandardMaterial()) {
  const parameters = new Map<string, unknown>();
  const mesh = { material: original, mask: 1, castShadow: true,
    setParameter: (key: string, value: unknown) => parameters.set(key, value),
    deleteParameter: (key: string) => parameters.delete(key) } as unknown as MeshInstance;
  const render = { meshInstances: [mesh], layers: [0] } as unknown as RenderComponent;
  const entity = new Entity(); entity.findComponents = () => [render];
  return { original, mesh, render, entity, parameters };
}

test("finish and model follow reviewed table and cabinet attachments through moves and detachment", () => {
  for (const [productId, targetId, kind, height] of [
    ["support-demo-table", "top", "surface", 75],
    ["support-demo-cabinet", "upper", "compartment", 51.5],
  ] as const) {
    const parent: Instance = { instanceId: "support", productId, pose: { xCm: 300, zCm: 250, yawRad: 0 } };
    const child: Instance = { instanceId: "child", productId: "support-demo-box", pose: { xCm: 0, zCm: 0, yawRad: 0 },
      attachment: { parentInstanceId: "support", profileRevision: "1", target: { id: targetId, kind },
        localPose: { xCm: 15, zCm: 2, yawRad: .2 } } };
    const placed = resolveAttachments([parent, child], PRODUCTS);
    const moved = moveWithAttachments(placed, PRODUCTS, "support", { xCm: 350, zCm: 300, yawRad: Math.PI / 2 });
    const detached = moveWithAttachments(moved, PRODUCTS, "child", { xCm: 200, zCm: 320, yawRad: -.7 }, null);
    const f = fixture(), finish = createFurnitureFinish(f.entity, product, profile, 1001);
    for (const [instances, expectedHeight] of [[placed, height], [moved, height], [detached, 0]] as const) {
      const pose = instances[1].pose;
      applyFurniturePose(f.entity, pose); finish.setPose(pose);
      const origin = f.parameters.get("uFurnitureOrigin") as Float32Array;
      f.entity.getLocalPosition().toArray().forEach((value, i) => assert.ok(Math.abs(value - origin[i]) < .00001));
      assert.ok(Math.abs(origin[1] - cmToScene(expectedHeight)) < .00001);
    }
    finish.dispose(); f.entity.destroy();
  }
});

test("per-instance shading preserves authored PBR and cached source materials", () => {
  const f = fixture(); f.original.gloss = 0.27; f.original.metalness = 0.64;
  f.original.emissive.set(0.2, 0.1, 0.03); f.original.emissiveIntensity = 3;
  const finish = createFurnitureFinish(f.entity, product, profile, 1001);
  const copy = f.mesh.material as StandardMaterial;
  assert.notEqual(copy, f.original);
  for (const key of ["gloss", "metalness", "emissiveIntensity", "blendType", "depthWrite"] as const)
    assert.equal(copy[key], f.original[key]);
  assert.deepEqual(copy.emissive, f.original.emissive);
  assert.equal(f.original.getShaderChunks(SHADERLANGUAGE_GLSL).has("endPS"), false);
  assert.deepEqual(f.render.layers, [1001]);
  // Real pinned engine field, not a mocked shader API. Browser evidence covers
  // shader compilation, the small off-centre tabletop shadow and its movement.
  assert.ok("ambientSH" in f.original);
  assert.deepEqual((copy as StandardMaterial & { ambientSH: Float32Array }).ambientSH, furnitureAmbient(profile));
  finish.dispose(); f.entity.destroy();
});

test("glass retains opacity and transmission while bypassing diffuse grade and opaque shadow", () => {
  const f = fixture(); f.original.blendType = BLEND_NORMAL; f.original.opacity = 0.35;
  const finish = createFurnitureFinish(f.entity, product, profile, 1001);
  const copy = f.mesh.material as StandardMaterial;
  assert.equal(copy.opacity, 0.35); assert.equal(copy.blendType, BLEND_NORMAL);
  assert.equal(copy.getShaderChunks(SHADERLANGUAGE_GLSL).has("endPS"), false);
  assert.equal(f.mesh.castShadow, false); assert.equal(f.original.opacity, 0.35);
  finish.dispose(); assert.equal(f.mesh.castShadow, true); f.entity.destroy();
});

test("unlit authored models retain their original material without relighting", () => {
  const f = fixture(); f.original.useLighting = false;
  const finish = createFurnitureFinish(f.entity, product, profile, 1001);
  assert.equal(f.mesh.material, f.original); assert.equal(f.parameters.size, 0);
  finish.dispose(); f.entity.destroy();
});

test("disposal releases each owned material exactly once and restores cached source", () => {
  const f = fixture(), finish = createFurnitureFinish(f.entity, product, profile, 1001);
  let disposed = 0; f.mesh.material.destroy = () => { disposed++; };
  finish.dispose(); finish.dispose();
  assert.equal(disposed, 1); assert.equal(f.mesh.material, f.original); assert.equal(f.parameters.size, 0);
  f.entity.destroy();
});

test("lighting profiles do not guess an unknown building from its name", () => {
  assert.equal(furnitureLightingProfile({ roomId: "london-skyscraper" } as Room).id, "neutral");
  assert.equal(furnitureLightingProfile({ roomId: "empty-room" } as Room).floorContact, 0);
  assert.equal(furnitureLightingProfile({ roomId: "haussmann-apartment" } as Room).shareRoomLights, undefined);
  assert.ok(profile.floorContact > 0 && profile.finish < 0.05);
});

test("cached shadows refresh for edits, camera travel, captures and animation completion", () => {
  const cache = createFurnitureShadowRefresh();
  const view = { x: 0, y: 32, z: 100, fx: 0, fy: 0, fz: -1, projection: 0, fov: 65, aspect: 1.5, target: null };
  assert.equal(cache.update(view, 1), true); assert.equal(cache.update(view, 2), false);
  assert.equal(cache.update({ ...view, x: cmToScene(16) }, 3), true);
  assert.equal(cache.update({ ...view, fx: 0.1, fz: -Math.sqrt(0.99) }, 4), true);
  const capture = { ...view, target: {} };
  assert.equal(cache.update(capture, 5), true); assert.equal(cache.update(view, 6), true);
  cache.invalidate(100, 10);
  assert.equal(cache.update(view, 11), true); assert.equal(cache.update(view, 109), true);
  assert.equal(cache.update(view, 111), false);
  cache.invalidate(0, 112); assert.equal(cache.update(view, 113), true);
});
