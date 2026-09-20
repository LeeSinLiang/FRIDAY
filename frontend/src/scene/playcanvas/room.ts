import { Entity, StandardMaterial, TEXTURETYPE_RGBM, type RenderComponent } from "playcanvas";
import type { Room } from "../types";
import { cmToScene, meterGlbToSceneScale } from "../units";
import type { AssetCache, AssetProgress } from "./assets";

type RoomVisual = Entity & { bakedExposureScale?: number };

/** The manifest is the single transform authority; never silently fit a scan to its bounds. */
export async function loadSplatRoom(assets: AssetCache, root: Entity, room: Room,
  progress?: (value: AssetProgress) => void, signal?: AbortSignal): Promise<RoomVisual> {
  if (!room.scan?.visualUrl) throw new Error("This room does not contain a visual asset");
  if (room.scan.visualFormat === "glb") {
    const model: RoomVisual = await assets.instantiateContainer(room.scan.visualUrl);
    if (signal?.aborted) { model.destroy(); throw new Error("Loading the room was cancelled"); }
    // The pinned glTF container exposes source material extras alongside its
    // material assets. Only our explicit carrier is interpreted as a lightmap.
    const resource = await assets.loadContainer(room.scan.visualUrl) as unknown as {
      data?: { gltf?: {
        asset?: { extras?: { fridayColorManagement?: { exposureScale?: number } } };
        materials?: { extras?: { fridayBakedLighting?: boolean; fridayLightMapEncoding?: string } }[];
      } };
      materials?: { resource?: StandardMaterial }[];
    };
    if (signal?.aborted) { model.destroy(); throw new Error("Loading the room was cancelled"); }
    const lightmapped = new Set<StandardMaterial>();
    resource.data?.gltf?.materials?.forEach((source, index) => {
      if (!source.extras?.fridayBakedLighting) return;
      const material = resource.materials?.[index]?.resource;
      if (!(material instanceof StandardMaterial) || !material.aoMap || material.aoMapUv !== 1
        || source.extras.fridayLightMapEncoding !== "rgbm") {
        model.destroy();
        throw new Error("The room lightmap must contain an RGBM texture on UV1");
      }
      const carrier = material.aoMap;
      // RGBM stores raw data, not sRGB color; avoid hardware gamma decoding.
      carrier.srgb = false;
      carrier.type = TEXTURETYPE_RGBM;
      material.lightMap = carrier;
      material.lightMapUv = 1;
      material.lightMapChannel = "rgb";
      material.lightMapTiling.copy(material.aoMapTiling);
      material.lightMapOffset.copy(material.aoMapOffset);
      material.lightMapRotation = material.aoMapRotation;
      material.aoMap = null;
      material.useLighting = false;
      material.useSkybox = false;
      material.update();
      lightmapped.add(material);
    });
    if (lightmapped.size) {
      model.tags.add("friday-linear-lightmap");
      const exposure = resource.data?.gltf?.asset?.extras?.fridayColorManagement?.exposureScale;
      model.bakedExposureScale = typeof exposure === "number" && Number.isFinite(exposure) && exposure > 0 ? exposure : 1;
    }
    for (const render of model.findComponents("render") as RenderComponent[]) {
      for (const instance of render.meshInstances) {
        const material = instance.material;
        // The baked atlas already contains architectural illumination. Preserve
        // the loader's unlit texture mapping and exclude it from shadow passes.
        if (material instanceof StandardMaterial && ((room.roomId === "cg-arch-interior" && material.name === "Baked room illumination") || lightmapped.has(material))) {
          material.useLighting = false;
          material.useSkybox = false;
          material.update();
          instance.castShadow = false;
          instance.receiveShadow = false;
        }
      }
    }
    model.setLocalPosition(...room.scan.positionCm.map(value => cmToScene(value)) as [number, number, number]);
    model.setLocalEulerAngles(...room.scan.rotationDeg);
    const scale = room.scan.scale * meterGlbToSceneScale();
    model.setLocalScale(scale, scale, scale);
    root.addChild(model);
    return model;
  }
  const asset = await assets.load(room.scan.visualUrl, "gsplat", progress);
  if (signal?.aborted) throw new Error("Loading the room was cancelled");
  const splat = new Entity(`Fixed scan · ${room.roomId}`);
  const { positionCm, rotationDeg, scale } = room.scan;
  splat.setLocalPosition(...positionCm.map(value => cmToScene(value)) as [number, number, number]);
  splat.setLocalEulerAngles(...rotationDeg);
  const renderScale = scale * meterGlbToSceneScale();
  splat.setLocalScale(renderScale, renderScale, renderScale);
  splat.addComponent("gsplat", { asset, unified: true });
  root.addChild(splat);
  return splat;
}
