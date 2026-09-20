import { BLEND_NORMAL, Color, Entity, Layer, LAYERID_WORLD, PIXELFORMAT_RGBA8, SHADOW_PCF3_32F, SHADOWUPDATE_THISFRAME, StandardMaterial, Texture,
  type Application, type RenderComponent } from "playcanvas";
import type { Product, Room } from "../types";
import { cmToScene } from "../units";
import { createFurnitureFinish } from "./furnitureFinish";
import { furnitureLightingProfile } from "./furnitureLightingProfile";

export type FurnitureAppearance = ReturnType<typeof createFurnitureAppearance>;

type ShadowView = { x: number; y: number; z: number; fx: number; fy: number; fz: number;
  projection: number; fov: number; aspect: number; target: unknown };

/** Reuse stationary world-space shadows between edits and small camera changes.
 * Refresh after 15 cm / 3 degrees; captures and changed projection always refresh. */
export function createFurnitureShadowRefresh() {
  let previous: ShadowView | undefined, dirty = true, animateUntil = 0;
  return {
    invalidate(durationMs = 0, now = performance.now()) { dirty = true; animateUntil = Math.max(animateUntil, now + durationMs); },
    update(view: ShadowView, now = performance.now()) {
      const changed = !previous || Math.hypot(view.x - previous.x, view.y - previous.y, view.z - previous.z) > cmToScene(15) ||
        view.fx * previous.fx + view.fy * previous.fy + view.fz * previous.fz < Math.cos(Math.PI / 60) ||
        view.projection !== previous.projection || view.fov !== previous.fov || view.aspect !== previous.aspect || view.target !== previous.target;
      if (!dirty && now > animateUntil && !changed) return false;
      previous = { ...view }; dirty = false; return true;
    },
  };
}

/** One room-scoped rig, one contact texture; never a light/texture per product. */
export function createFurnitureAppearance(app: Application, camera: Entity, room: Room) {
  const profile = furnitureLightingProfile(room);
  const layer = new Layer({ name: "Editable furniture lighting" });
  const composition = app.scene.layers;
  composition.insertOpaque(layer, composition.layerList.findIndex(l => l.id === LAYERID_WORLD) + 1);
  const worldTransparent = composition.layerList.findIndex((l, i) => l.id === LAYERID_WORLD && composition.subLayerList[i]);
  composition.insertTransparent(layer, worldTransparent + 1);
  camera.camera!.layers = [...camera.camera!.layers, layer.id];
  const lights: Entity[] = [];
  let shadowLight: Entity | undefined;
  const shadowRefresh = createFurnitureShadowRefresh();
  const shared: { entity: Entity; layers: number[]; castShadows: boolean }[] = [];
  for (const [name, definition] of [["key", profile.key], ["fill", profile.fill]] as const) {
    const existing = profile.shareRoomLights ? app.root.findByName(name === "key" ? "Soft window light" : "Cool room fill") as Entity | null : null;
    const light = existing ?? new Entity(`Furniture ${profile.id} ${name}`);
    if (existing?.light) {
      shared.push({ entity: existing, layers: [...existing.light.layers], castShadows: existing.light.castShadows });
      existing.light.layers = [...existing.light.layers, layer.id];
    } else {
      light.addComponent("light", { type: "directional", color: new Color(...definition.color), intensity: definition.intensity, layers: [layer.id] });
      light.setEulerAngles(...definition.angles);
      app.root.addChild(light); lights.push(light);
    }
    if (name === "key") {
      shadowLight = light;
      Object.assign(light.light!, { castShadows: true, shadowType: SHADOW_PCF3_32F, shadowResolution: 1024,
        shadowDistance: cmToScene(600), numCascades: 1, shadowBias: 0.12, normalOffsetBias: 0.16 });
    }
  }
  const updateShadows = () => {
    const p = camera.getPosition(), f = camera.forward, component = camera.camera!;
    if (shadowRefresh.update({ x: p.x, y: p.y, z: p.z, fx: f.x, fy: f.y, fz: f.z,
      projection: component.projection, fov: component.fov, aspect: component.aspectRatio, target: component.renderTarget }))
      shadowLight!.light!.shadowUpdateMode = SHADOWUPDATE_THISFRAME;
  };
  app.on("prerender", updateShadows);

  let contactMaterial: StandardMaterial | undefined;
  let contactTexture: Texture | undefined;
  if (profile.floorContact > 0) {
    const size = 64, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5 - size / 2) / (size / 2), (y + 0.5 - size / 2) / (size / 2));
      data[(y * size + x) * 4 + 3] = Math.round(255 * Math.max(0, 1 - radius * radius) ** 2);
    }
    contactTexture = new Texture(app.graphicsDevice, { name: "Furniture soft contact", width: size, height: size,
      format: PIXELFORMAT_RGBA8, mipmaps: false, levels: [data] });
    contactMaterial = new StandardMaterial();
    contactMaterial.useLighting = false; contactMaterial.useSkybox = false;
    contactMaterial.diffuse = new Color(0, 0, 0);
    contactMaterial.opacityMap = contactTexture; contactMaterial.opacityMapChannel = "a";
    contactMaterial.blendType = BLEND_NORMAL; contactMaterial.depthWrite = false;
    contactMaterial.opacity = profile.floorContact; contactMaterial.update();
  }
  let disposed = false;
  return {
    profile, layerId: layer.id,
    invalidateShadows: shadowRefresh.invalidate,
    prepareRoom(model: Entity) {
      if (!profile.shareRoomLights) return;
      // This authored fixture had no architecture shadows before. Exclude its
      // enclosing ceiling from the indoor key, while letting the floor receive
      // actual furniture shadows. Baked rooms are never changed here.
      for (const render of model.findComponents("render") as RenderComponent[])
        for (const mesh of render.meshInstances) { mesh.castShadow = false; mesh.receiveShadow = true; }
    },
    dress(model: Entity, product: Product) {
      shadowRefresh.invalidate();
      return createFurnitureFinish(model, product, profile, layer.id, app.graphicsDevice.maxAnisotropy);
    },
    contact(product: Product) {
      if (!contactMaterial) return undefined;
      const entity = new Entity("Baked floor contact approximation");
      entity.addComponent("render", { type: "plane", material: contactMaterial, layers: [layer.id], castShadows: false, receiveShadows: false });
      entity.setLocalScale(cmToScene(product.widthCm * 1.1), 1, cmToScene(product.depthCm * 1.1));
      // Sub-centimetre bias clears the prepared mesh's floor sampling tolerance.
      entity.setLocalPosition(0, cmToScene(0.8), 0);
      return entity;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      app.off("prerender", updateShadows);
      for (const light of lights) light.destroy();
      for (const { entity, layers, castShadows } of shared) if (entity.light) { entity.light.layers = layers; entity.light.castShadows = castShadows; }
      camera.camera!.layers = camera.camera!.layers.filter(id => id !== layer.id);
      composition.remove(layer);
      contactMaterial?.destroy(); contactTexture?.destroy();
    },
  };
}
