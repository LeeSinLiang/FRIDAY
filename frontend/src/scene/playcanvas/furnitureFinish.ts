import { BLEND_NONE, Color, SHADERLANGUAGE_GLSL, StandardMaterial, type Entity, type MeshInstance, type RenderComponent } from "playcanvas";
import type { Pose, Product } from "../types";
import { cmToScene } from "../units";
import type { FurnitureLightingProfile } from "./furnitureLightingProfile";

// Pinned to PlayCanvas 2.22.2 endPS. Only the diffuse contribution is softened;
// authored roughness, normal maps, specular response, emission and glass survive.
const finishChunk = `
  float furnitureHeight = clamp((vPositionW.y - uFurnitureOrigin.y) / uFurnitureHeight, 0.0, 1.0);
  dDiffuseLight *= mix(1.0 - uFurnitureFinish, 1.0, smoothstep(0.0, 1.0, furnitureHeight));
  gl_FragColor.rgb = combineColor(litArgs_albedo, litArgs_sheen_specularity, litArgs_clearcoat_specularity);
  gl_FragColor.rgb += litArgs_emission;
  gl_FragColor.rgb = addFog(gl_FragColor.rgb);
  gl_FragColor.rgb = toneMap(gl_FragColor.rgb);
  gl_FragColor.rgb = gammaCorrectOutput(gl_FragColor.rgb);
`;

/** Constant SH supplies furniture-only ambient without recolouring baked architecture. */
export function furnitureAmbient(profile: FurnitureLightingProfile) {
  const linear = new Color(...profile.ambient).linear();
  const result = new Float32Array(27);
  result.set([linear.r, linear.g, linear.b]);
  return result;
}

export function createFurnitureFinish(model: Entity, product: Product, profile: FurnitureLightingProfile, layerId: number,
  maxAnisotropy = 1) {
  const materials = new Map<StandardMaterial, StandardMaterial>();
  const instances: { mesh: MeshInstance; original: StandardMaterial; castShadow: boolean }[] = [];
  const ambient = furnitureAmbient(profile);
  for (const render of model.findComponents("render") as RenderComponent[]) {
    render.layers = [layerId];
    for (const mesh of render.meshInstances) {
      const original = mesh.material;
      if (!(original instanceof StandardMaterial) || !original.useLighting) continue;
      let copy = materials.get(original);
      if (!copy) {
        copy = original.clone();
        // Keep the environment for reflections (London already owns an HDR atlas).
        // A source-provided light probe takes precedence over our room estimate.
        // Present in the pinned engine's standard-material.js but omitted from
        // its generated declarations. Keep this adapter and its engine test local.
        (copy as StandardMaterial & { ambientSH: Float32Array | null }).ambientSH ??= ambient;
        for (const texture of [copy.diffuseMap, copy.normalMap, copy.glossMap, copy.metalnessMap, copy.aoMap])
          if (texture) texture.anisotropy = Math.min(8, maxAnisotropy);
        const chunks = copy.getShaderChunks(SHADERLANGUAGE_GLSL);
        if (profile.finish > 0 && copy.blendType === BLEND_NONE && !chunks.has("endPS")) {
          copy.shaderChunksVersion = "2.22";
          chunks.set("litUserDeclarationPS", (chunks.get("litUserDeclarationPS") ?? "") +
            "\nuniform vec3 uFurnitureOrigin;\nuniform float uFurnitureHeight;\nuniform float uFurnitureFinish;\n");
          chunks.set("endPS", finishChunk);
        }
        copy.update();
        materials.set(original, copy);
      }
      instances.push({ mesh, original, castShadow: mesh.castShadow });
      mesh.material = copy;
      // Transparent glass must not produce an opaque black silhouette.
      if (copy.blendType !== BLEND_NONE && copy.alphaTest === 0) mesh.castShadow = false;
      mesh.setParameter("uFurnitureHeight", Math.max(cmToScene(product.heightCm), 0.01));
      mesh.setParameter("uFurnitureFinish", profile.finish);
    }
  }
  let disposed = false;
  return {
    setPose(pose: Pose, supportHeightCm: number) {
      const origin = new Float32Array([cmToScene(pose.xCm), cmToScene(supportHeightCm), cmToScene(pose.zCm)]);
      for (const { mesh } of instances) mesh.setParameter("uFurnitureOrigin", origin);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { mesh, original, castShadow } of instances) {
        mesh.material = original; mesh.castShadow = castShadow;
        for (const name of ["uFurnitureOrigin", "uFurnitureHeight", "uFurnitureFinish"]) mesh.deleteParameter(name);
      }
      for (const material of materials.values()) material.destroy();
    },
  };
}
