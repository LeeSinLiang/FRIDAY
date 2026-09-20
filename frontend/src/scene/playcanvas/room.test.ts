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

// The same checked manifests drive frontend rejection and the backend tool tests.
import lowerFloor from "../../../../shared/rooms/london-skyscraper-test/manifest.json";
import middleFloor from "../../../../shared/rooms/london-skyscraper-c17/manifest.json";
import upperFloor from "../../../../shared/rooms/london-skyscraper-c32/manifest.json";
import lowerSpatial from "../../../../shared/rooms/london-skyscraper-test/spatial.json";
import middleSpatial from "../../../../shared/rooms/london-skyscraper-c17/spatial.json";
import upperSpatial from "../../../../shared/rooms/london-skyscraper-c32/spatial.json";
import sceneFixtures from "../../../../shared/scene-fixtures.json";
import { validatePlacement } from "../placement";
import { cmToScene, meterGlbToSceneScale } from "../units";
import type { Product } from "../types";

test("three skyscraper floors preserve source metres, materials and independent elevations", async () => {
  for (const manifest of [lowerFloor, middleFloor, upperFloor]) {
    const f = fixture(false);
    const room = manifest.room as unknown as Room;
    const model = await loadSplatRoom(f.assets, f.root, room);
    const pos = model.getLocalPosition();
    assert.ok(Math.abs(pos.y + cmToScene(manifest.room.scan.building.elevationM * 100)) < .0002);
    assert.equal(model.getLocalScale().x, meterGlbToSceneScale());
    assert.equal(f.material.diffuseMap, f.albedo);
    assert.equal(f.material.aoMap, f.carrier);
  }
});

test("skyscraper footprint checks accept dragging and rotation but reject unchecked edges", () => {
  const product = sceneFixtures.products.find(item => item.productId === "scale-reference") as Product;
  for (const [manifest, spatial] of [[lowerFloor, lowerSpatial], [middleFloor, middleSpatial], [upperFloor, upperSpatial]] as const) {
    const room = {...manifest.room, spatial} as unknown as Room;
    const item = {instanceId:"reference", productId:product.productId, pose:{xCm:250,zCm:450,yawRad:0}};
    for (const pose of [item.pose, {...item.pose,xCm:300}, {...item.pose,yawRad:Math.PI/2}])
      assert.equal(validatePlacement(room,[product],[item],item.instanceId,pose).valid,true);
    const outside = validatePlacement(room,[product],[item],item.instanceId,{...item.pose,xCm:100});
    assert.equal(outside.valid,false);
    assert.equal(outside.code,"unknown_area");
  }
});
