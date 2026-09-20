import * as pc from "playcanvas";
import type { Room } from "../types";
import { cmToScene, meterGlbToSceneScale } from "../units";
import type { PlayCanvasRuntime } from "./runtime";

/** Diagnostic wireframe only. It never authorizes a placement or writes visual occlusion depth. */
export function createSurfaceReference(runtime: PlayCanvasRuntime,
  onStatus?: (status: "loading" | "ready" | "error", message?: string) => void) {
  const root = new pc.Entity("Surface reference · approximate");
  runtime.contentRoot.addChild(root);
  root.enabled = false;
  const material = new pc.StandardMaterial();
  material.useLighting = false;
  material.diffuse = new pc.Color().fromString("#d6aa63");
  material.emissive = new pc.Color().fromString("#79603b");
  material.blendType = pc.BLEND_NORMAL;
  material.opacity = 0.52;
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;
  material.update();
  let wanted = false;
  let disposed = false;
  let loading = false;
  let sourceUrl: string | undefined;
  let loadedUrl: string | undefined;
  let failedUrl: string | undefined;
  let sequence = 0;
  let model: pc.Entity | null = null;
  const load = async (url: string) => {
    const request = ++sequence;
    loading = true; onStatus?.("loading", "Loading the approximate surface reference…");
    try {
      const entity = await runtime.assets.instantiateContainer(url);
      if (disposed || runtime.disposed || request !== sequence) { entity.destroy(); return; }
      for (const render of entity.findComponents("render") as pc.RenderComponent[]) {
        render.castShadows = false; render.receiveShadows = false;
        for (const mesh of render.meshInstances) {
          mesh.material = material;
          mesh.renderStyle = pc.RENDERSTYLE_WIREFRAME;
        }
      }
      model?.destroy(); model = entity; root.addChild(entity);
      loadedUrl = url; root.enabled = wanted;
      onStatus?.("ready", runtime.room.scan?.visualFormat === "glb" ? "Authored mesh; placement is limited to the configured floor map." : "Approximate splat-derived surface; placement uses the reviewed floor map.");
    } catch (error) {
      if (!disposed && request === sequence) {
        failedUrl = url;
        root.enabled = false;
        onStatus?.("error", error instanceof Error ? error.message : "The surface reference could not load");
      }
    } finally { if (request === sequence) loading = false; }
  };
  return {
    update(room: Room, visible: boolean) {
      const scan = room.scan;
      if (visible && !wanted) failedUrl = undefined;
      wanted = visible;
      const url = scan?.surfaceUrl;
      if (sourceUrl !== url) {
        sourceUrl = url; sequence++; loading = false; loadedUrl = undefined; failedUrl = undefined;
        model?.destroy(); model = null;
      }
      root.enabled = !!(visible && model && loadedUrl === url);
      if (!scan || !url) return;
      root.setLocalPosition(...scan.positionCm.map(value => cmToScene(value)) as [number, number, number]);
      // SplatTransform voxel 1.1 geometry is already in engine coordinates. No source-PLY flip.
      root.setLocalEulerAngles(0, 0, 0);
      const scale = scan.scale * meterGlbToSceneScale();
      root.setLocalScale(scale, scale, scale);
      if (visible && !loading && loadedUrl !== url && failedUrl !== url) void load(url);
    },
    dispose() { if (disposed) return; disposed = true; sequence++; root.destroy(); material.destroy(); },
  };
}
