import { Color, Entity, EnvLighting, LAYERID_SKYBOX, PROJECTION_PERSPECTIVE, SHADOW_PCF3_32F, StandardMaterial, TONEMAP_ACES, TONEMAP_LINEAR, Texture,
  type Application, type RenderComponent } from "playcanvas";
import type { AssetCache } from "./assets";
import type { Room } from "../types";
import { cmToScene } from "../units";

/** Explicitly scoped: other GLBs and baked/splat rooms retain their existing renderer. */
export const isLondonSkyscraper = (room: Room) => room.scan?.building?.sourceSha256 ===
  "0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9";

export function prepareSkyscraperMaterials(model: Entity, maxAnisotropy: number) {
  const seen = new Set<StandardMaterial>();
  for (const render of model.findComponents("render") as RenderComponent[]) {
    for (const instance of render.meshInstances) {
      const material = instance.material;
      if (!(material instanceof StandardMaterial)) continue;
      // Source glass has BLEND enabled but an entirely opaque alpha texture.
      // Correct the rendered factor while preserving the source image/UVs/tint.
      if (material.name.startsWith("Glass_")) instance.castShadow = false;
      if (seen.has(material)) continue;
      seen.add(material);
      for (const texture of [material.diffuseMap, material.normalMap, material.glossMap, material.metalnessMap,
        material.opacityMap, material.emissiveMap, material.aoMap]) {
        if (texture) texture.anisotropy = Math.min(8, maxAnisotropy);
      }
      if (material.name.startsWith("Glass_")) {
        material.opacity = material.name === "Glass_Generic_More_Opaque" ? 0.3 : 0.12;
        material.depthWrite = false;
        material.useSkybox = true;
      }
      if (material.name === "Building_Facade") material.alphaTest = 0.4;
      material.update();
    }
  }
}

/** Daylight and reflections are shared across floor transforms; no texture rewriting. */
export function createSkyscraperLighting(app: Application, camera: Entity, assets: AssetCache) {
  app.scene.ambientLight = new Color(0.18, 0.2, 0.23);
  app.scene.exposure = 1;
  camera.camera!.toneMapping = TONEMAP_ACES;
  const sun = new Entity("Skyscraper daylight");
  sun.addComponent("light", { type: "directional", color: new Color(1, 0.96, 0.89), intensity: 1.8,
    castShadows: true, shadowType: SHADOW_PCF3_32F, shadowResolution: 2048,
    shadowDistance: cmToScene(4500), numCascades: 3, shadowBias: 0.15, normalOffsetBias: 0.2 });
  sun.setEulerAngles(28, -38, 0);
  app.root.addChild(sun);
  let disposed = false;
  let sky: Texture | undefined, lighting: Texture | undefined, atlas: Texture | undefined;
  const updateView = () => {
    const perspective = camera.camera!.projection === PROJECTION_PERSPECTIVE;
    const layer = app.scene.layers.getLayerById(LAYERID_SKYBOX);
    if (layer) layer.enabled = perspective;
    camera.camera!.toneMapping = perspective ? TONEMAP_ACES : TONEMAP_LINEAR;

  };
  app.on("update", updateView);
  const ready = assets.load("/environments/london-daylight.hdr", "texture").then(asset => {
    if (disposed) return;
    const source = asset.resource as Texture;
    sky = EnvLighting.generateSkyboxCubemap(source, 256);
    lighting = EnvLighting.generateLightingSource(source, { size: 128 });
    atlas = EnvLighting.generateAtlas(lighting, { size: 512, numReflectionSamples: 256, numAmbientSamples: 512 });
    app.scene.skybox = sky;
    app.scene.envAtlas = atlas;
    app.scene.skyboxIntensity = 0.8;
    app.renderNextFrame = true;
  });
  // Runtime.ready reports load errors after the model settles; avoid an early
  // unhandled rejection when the smaller environment finishes first.
  void ready.catch(() => {});
  return {
    ready,
    dispose() {
      disposed = true;
      app.off("update", updateView);
      sun.destroy();
      app.scene.skybox = null;
      app.scene.envAtlas = null;
      sky?.destroy(); lighting?.destroy(); atlas?.destroy();
    },
  };
}
