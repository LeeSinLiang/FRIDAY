import assert from "node:assert/strict";
import test from "node:test";
import { Entity, StandardMaterial, TEXTURETYPE_RGBM, type RenderComponent, type Texture } from "playcanvas";
import emptyManifest from "../../../../shared/rooms/empty-room/manifest.json";
import type { Room } from "../types";
import type { AssetCache } from "./assets";
import { loadSplatRoom } from "./room";

function fixture(marked: boolean, encoding = "rgbm") {
  const material = new StandardMaterial();
  // GPU allocation is irrelevant to the container/material handoff contract.
  const carrier = { srgb: true, type: "default" } as unknown as Texture;
  const albedo = { id: 2 } as unknown as Texture;
  material.diffuseMap = albedo;
  material.aoMap = carrier;
  material.aoMapUv = 1;
  const meshInstance = { material, castShadow: true, receiveShadow: true };
  const model = new Entity("Proof mesh");
  model.findComponents = () => [{ meshInstances: [meshInstance] } as unknown as RenderComponent];
  const root = new Entity("Root");
  const assets = {
    instantiateContainer: async () => model,
    loadContainer: async () => ({
      data: { gltf: {
        asset: { extras: { fridayColorManagement: { exposureScale: 7.78954 } } },
        materials: [{ extras: marked ? { fridayBakedLighting: true, fridayLightMapEncoding: encoding } : {} }],
      } },
      materials: [{ resource: material }],
    }),
  } as unknown as AssetCache;
  const room = { ...emptyManifest.room, roomId: "cg-arch-lightmapper-proof" } as unknown as Room;
  return { material, carrier, albedo, meshInstance, model, root, assets, room };
}

test("independent proof rooms consume explicit RGBM lightmaps without losing source albedo", async () => {
  const f = fixture(true);
  const result = await loadSplatRoom(f.assets, f.root, f.room);
  assert.equal(result.parent, f.root);
  assert.equal(f.material.diffuseMap, f.albedo);
  assert.equal(f.material.diffuseMapUv, 0);
  assert.equal(f.material.lightMap, f.carrier);
  assert.equal(f.material.lightMapUv, 1);
  assert.equal(f.carrier.srgb, false);
  assert.equal(f.carrier.type, TEXTURETYPE_RGBM);
  assert.equal(f.material.aoMap, null);
  assert.equal(f.material.useLighting, false);
  assert.equal(f.meshInstance.receiveShadow, false);
  assert.equal(result.bakedExposureScale, 7.78954);
});

test("unmarked mesh materials retain ordinary AO and lighting even with a legacy atlas name", async () => {
  const f = fixture(false);
  f.material.name = "Baked room illumination";
  const result = await loadSplatRoom(f.assets, f.root, { ...f.room, roomId: "empty-room" });
  assert.equal(f.material.aoMap, f.carrier);
  assert.equal(f.material.lightMap, null);
  assert.equal(f.material.useLighting, true);
  assert.equal(f.meshInstance.receiveShadow, true);
  assert.equal(result.tags.has("friday-linear-lightmap"), false);
  assert.equal(result.bakedExposureScale, undefined);
});

test("a malformed proof lightmap fails before adding the model to the room", async () => {
  const f = fixture(true, "unsupported");
  let destroyed = false;
  f.model.destroy = () => { destroyed = true; };
  await assert.rejects(loadSplatRoom(f.assets, f.root, f.room), /RGBM texture on UV1/);
  assert.equal(destroyed, true);
  assert.equal(f.root.children.length, 0);
});
