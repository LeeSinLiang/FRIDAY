import * as pc from "playcanvas";
import type { Instance, Pose, Product } from "../types";
import { cmToScene, meterGlbToSceneScale } from "../units";
import type { ModelStatus } from "./contracts";

export type FurnitureRuntime = {
  assets: { instantiateContainer(url: string): Promise<pc.Entity> };
  disposed: boolean;
};
export type FurnitureVisual = {
  entity: pc.Entity;
  ready: Promise<string | undefined>;
  dispose(): void;
};

export function applyFurniturePose(entity: pc.Entity, pose: Pose) {
  entity.setLocalPosition(cmToScene(pose.xCm), 0, cmToScene(pose.zCm));
  entity.setLocalEulerAngles(0, pose.yawRad * pc.math.RAD_TO_DEG, 0);
}

/** PlayCanvas 2 uses normalized gloss; legacy shininess-sized values overflow its shader. */
export function createProxyMaterials(color: string) {
  const material = (color: string, gloss: number, metalness = 0) => {
    const result = new pc.StandardMaterial();
    result.diffuse = new pc.Color().fromString(color);
    result.gloss = gloss;
    result.useMetalness = true;
    result.metalness = metalness;
    result.update();
    return result;
  };
  const fabric = material(color, 0.12);
  const seam = material(color, 0.08);
  seam.diffuse.mulScalar(0.83); seam.update();
  const wood = material("#574333", 0.28);
  const stone = material(color, 0.25);
  return { fabric, seam, wood, stone };
}

/** Dimensioned, floor-pivoted proxies remain visible while real GLBs load or fail. */
function createProxy(product: Product) {
  const root = new pc.Entity(`Dimensioned ${product.kind}`);
  const materials = createProxyMaterials(product.color);
  const { fabric, seam, wood, stone } = materials;
  const shape = (name: string, type: "box" | "sphere" | "cylinder" | "capsule", size: [number, number, number], position: [number, number, number], surface: pc.StandardMaterial) => {
    const entity = new pc.Entity(name);
    entity.addComponent("render", { type, material: surface, castShadows: true, receiveShadows: true });
    entity.setLocalScale(...size.map(value => cmToScene(value)) as [number, number, number]);
    entity.setLocalPosition(...position.map(value => cmToScene(value)) as [number, number, number]);
    root.addChild(entity);
    return entity;
  };
  const w = product.widthCm, d = product.depthCm, h = product.heightCm;
  if (product.kind === "table") {
    // Flattened spheres produce the soft stone profile without adding a mesh dependency.
    const top = h * 0.2;
    shape("Soft stone top", "sphere", [w, top, d], [0, h - top / 2, 0], stone);
    const legHeight = h - top * 0.58;
    for (const side of [-1, 1]) shape("Stone pedestal", "cylinder", [w * 0.22, legHeight, d * 0.53], [side * w * 0.25, legHeight / 2, 0], stone);
  } else {
    const seatHeight = h * 0.52;
    const armWidth = w * (product.kind === "chair" ? 0.13 : 0.09);
    const innerWidth = w - armWidth * 2;
    const legHeight = h * 0.1;
    shape("Upholstered base", "box", [w * 0.9, h * 0.22, d * 0.88], [0, legHeight + h * 0.11, 0], seam);
    const cushionCount = product.kind === "sofa" ? 2 : 1;
    for (let i = 0; i < cushionCount; i++) {
      const cushionW = innerWidth / cushionCount;
      const x = (i - (cushionCount - 1) / 2) * cushionW;
      shape("Rounded seat cushion", "sphere", [cushionW * 1.03, h * 0.27, d * 0.92], [x, seatHeight - h * 0.1, d * 0.03], fabric);
      shape("Rounded back cushion", "sphere", [cushionW * 1.06, h * 0.66, d * 0.26], [x, h * 0.67, -d * 0.34], fabric);
    }
    for (const side of [-1, 1]) {
      shape("Rounded arm", "sphere", [armWidth * 2, h * 0.65, d], [side * (w / 2 - armWidth), h * 0.5, 0], fabric);
      for (const z of [-1, 1]) shape("Oak foot", "cylinder", [w * 0.035, legHeight, d * 0.055], [side * w * 0.35, legHeight / 2, z * d * 0.33], wood);
    }
  }
  return { root, dispose: () => { root.destroy(); for (const surface of Object.values(materials)) surface.destroy(); } };
}

export function createFurnitureVisual(runtime: FurnitureRuntime, instance: Instance, product: Product,
  onStatus?: (status: ModelStatus) => void): FurnitureVisual {
  const entity = new pc.Entity(`Furniture · ${instance.instanceId}`);
  applyFurniturePose(entity, instance.pose);
  let disposed = false;
  let proxy: ReturnType<typeof createProxy> | null = createProxy(product);
  entity.addChild(proxy.root);
  let model: pc.Entity | null = null;
  const ready = (async (): Promise<string | undefined> => {
    if (!product.modelUrl) { onStatus?.("proxy"); return `${product.name}: dimensioned preview model`; }
    onStatus?.("loading");
    try {
      const loaded = await runtime.assets.instantiateContainer(product.modelUrl);
      if (disposed || runtime.disposed) { loaded.destroy(); return "Model load cancelled"; }
      const scale = meterGlbToSceneScale();
      // Apply unit conversion above the imported hierarchy so authored root transforms survive.
      model = new pc.Entity("Meter model conversion");
      model.setLocalScale(scale, scale, scale);
      model.addChild(loaded);
      entity.addChild(model);
      proxy?.dispose(); proxy = null;
      onStatus?.("ready");
      return undefined;
    } catch (error) {
      if (!disposed && !runtime.disposed) onStatus?.("error");
      return `${product.name}: model unavailable; dimensioned preview used (${error instanceof Error ? error.message : "load failed"})`;
    }
  })();
  return {
    entity, ready,
    dispose() {
      if (disposed) return;
      disposed = true;
      proxy?.dispose(); proxy = null;
      model?.destroy(); model = null;
      entity.destroy();
    },
  };
}

/** Frozen screenshot geometry shares source resources but owns its own hierarchy. */
export async function createFurnitureEntity(runtime: FurnitureRuntime, instance: Instance, product: Product) {
  const visual = createFurnitureVisual(runtime, instance, product);
  const warning = await visual.ready;
  return { entity: visual.entity, warning, dispose: visual.dispose };
}

export function createFurnitureLayer(runtime: FurnitureRuntime, parent: pc.Entity,
  status: (id: string, status: ModelStatus) => void) {
  const entries = new Map<string, { signature: string; visual: FurnitureVisual }>();
  return {
    sync(instances: Instance[], products: Product[], retries: Record<string, number>, movingId?: string) {
      const present = new Set(instances.map(instance => instance.instanceId));
      for (const [id, entry] of entries) if (!present.has(id)) { entry.visual.dispose(); entries.delete(id); }
      for (const instance of instances) {
        const product = products.find(item => item.productId === instance.productId);
        if (!product) continue;
        const signature = JSON.stringify([product, retries[instance.instanceId] ?? 0]);
        let entry = entries.get(instance.instanceId);
        if (entry?.signature !== signature) {
          entry?.visual.dispose();
          const visual = createFurnitureVisual(runtime, instance, product, value => status(instance.instanceId, value));
          parent.addChild(visual.entity);
          entry = { signature, visual }; entries.set(instance.instanceId, entry);
        }
        if (instance.instanceId !== movingId) applyFurniturePose(entry.visual.entity, instance.pose);
      }
    },
    preview(id: string, pose: Pose) { const entry = entries.get(id); if (entry) applyFurniturePose(entry.visual.entity, pose); },
    setVisible(id: string, visible: boolean) { const entry = entries.get(id); if (entry) entry.visual.entity.enabled = visible; },
    dispose() { for (const entry of entries.values()) entry.visual.dispose(); entries.clear(); },
  };
}
