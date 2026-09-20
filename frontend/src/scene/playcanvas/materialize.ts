import * as pc from "playcanvas";
import { createGoldenThreads } from "./goldenThreads";

export const MATERIALIZE_DURATION_MS = 2200;
export const MATERIALIZE_PREVIEW_EVENT = "friday:preview-furniture-materialize";
export const MATERIALIZE_COMPLETE_EVENT = "friday:furniture-materialized";

export function materializeFrame(elapsedMs: number) {
  const t = Math.max(0, Math.min(1, elapsedMs / MATERIALIZE_DURATION_MS));
  return { complete: t === 1, progress: t * t * (3 - 2 * t) };
}

// PlayCanvas 2.22 GLSL standard-material hooks. Preserve texture/vertex inputs;
// discard unrevealed fragments instead of blending the furniture with the room.
const opacityChunk = `
uniform float material_opacity;
uniform float material_alphaDitherScale;
uniform float summonHeight;
uniform float summonBand;
uniform float summonExtent;
// Thin, antialiased silk-like curves follow the actual surface. The pattern stays
// anchored in world space rather than crawling or sparkling between frames.
float summonFilament(float phase) {
  float distanceToThread = abs(fract(phase) - 0.5);
  float feather = max(fwidth(phase) * 0.75, 0.008);
  return 1.0 - smoothstep(0.008, 0.008 + feather, distanceToThread);
}
float summonThreads() {
  vec3 p = vPositionW / summonExtent;
  float warp = summonFilament((p.x + p.z * 0.63) * 0.85 + sin(p.y * 3.0 + p.z * 1.5) * 0.55);
  return warp;
}
void getOpacity() {
  float ahead = vPositionW.y - summonHeight;
  float reach = summonBand * 6.0;
  float tip = 1.0 - smoothstep(reach * 0.55, reach, ahead);
  if (ahead > 0.0 && summonThreads() * tip < 0.38) discard;
  dAlpha = material_opacity;
  #ifdef STD_OPACITY_TEXTURE
  dAlpha *= texture2DBias({STD_OPACITY_TEXTURE_NAME}, {STD_OPACITY_TEXTURE_UV}, textureBias).{STD_OPACITY_TEXTURE_CHANNEL};
  #endif
  #ifdef STD_OPACITY_VERTEX
  dAlpha *= clamp(vVertexColor.{STD_OPACITY_VERTEX_CHANNEL}, 0.0, 1.0);
  #endif
}`;
const emissionChunk = `
uniform vec3 material_emissive;
uniform float material_emissiveIntensity;
void getEmission() {
  dEmission = material_emissive * material_emissiveIntensity;
  #ifdef STD_EMISSIVE_TEXTURE
  dEmission *= {STD_EMISSIVE_TEXTURE_DECODE}(texture2DBias({STD_EMISSIVE_TEXTURE_NAME}, {STD_EMISSIVE_TEXTURE_UV}, textureBias)).{STD_EMISSIVE_TEXTURE_CHANNEL};
  #endif
  #ifdef STD_EMISSIVE_VERTEX
  dEmission *= saturate(vVertexColor.{STD_EMISSIVE_VERTEX_CHANNEL});
  #endif
  float distanceFromWeave = vPositionW.y - summonHeight;
  float trail = smoothstep(-summonBand * 7.0, -summonBand, distanceFromWeave);
  float tip = 1.0 - smoothstep(summonBand * 3.3, summonBand * 6.0, distanceFromWeave);
  float silk = summonThreads() * trail * tip;
  // Champagne gold, not a neon outline. It disappears into the original fabric.
  dEmission += vec3(0.8, 0.48, 0.13) * silk;
}`;

/** Build in place: no entity transform, opacity, scene pose or collision changes. */
export function animateMaterialization(presentation: pc.Entity, reducedMotion: () => boolean,
  schedule = requestAnimationFrame, cancel = cancelAnimationFrame, onComplete?: () => void) {
  let frameId = 0;
  let stopped = false;
  let threads: ReturnType<typeof createGoldenThreads> = null;
  const bindings: { mesh: pc.MeshInstance; original: pc.Material; temporary: pc.StandardMaterial; castShadow: boolean }[] = [];
  const restore = () => {
    if (stopped) return;
    stopped = true;
    cancel(frameId);
    threads?.dispose();
    for (const { mesh, original, temporary, castShadow } of bindings) {
      mesh.material = original; mesh.castShadow = castShadow; temporary.destroy();
    }
  };
  if (reducedMotion()) { onComplete?.(); return restore; }
  const meshes = (presentation.findComponents("render") as pc.RenderComponent[]).flatMap(component => component.meshInstances);
  let minY = Infinity, maxY = -Infinity;
  for (const mesh of meshes) {
    if (!(mesh.material instanceof pc.StandardMaterial)) continue;
    minY = Math.min(minY, mesh.aabb.center.y - mesh.aabb.halfExtents.y);
    maxY = Math.max(maxY, mesh.aabb.center.y + mesh.aabb.halfExtents.y);
  }
  if (!Number.isFinite(minY) || maxY <= minY) { onComplete?.(); return restore; }
  const height = maxY - minY;
  const band = height * 0.035;
  for (const mesh of meshes) {
    if (!(mesh.material instanceof pc.StandardMaterial)) continue;
    const original = mesh.material;
    const temporary = original.clone();
    temporary.shaderChunksVersion = "2.22";
    temporary.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("opacityPS", opacityChunk);
    temporary.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set("emissivePS", emissionChunk);
    temporary.alphaTest = Math.max(original.alphaTest, 0.001);
    temporary.setParameter("summonHeight", minY - band * 7);
    temporary.setParameter("summonExtent", height);
    temporary.setParameter("summonBand", band);
    temporary.update();
    bindings.push({ mesh, original, temporary, castShadow: mesh.castShadow });
    mesh.material = temporary;
    // Avoid an invisible object casting its full shadow before it is revealed.
    mesh.castShadow = false;
  }
  threads = createGoldenThreads(presentation, meshes);
  threads?.update(0);
  let start: number | undefined;
  const tick = (time: number) => {
    if (stopped) return;
    start ??= time;
    const value = materializeFrame(time - start);
    if (reducedMotion() || value.complete) { restore(); onComplete?.(); return; }
    threads?.update(value.progress);
    for (const { temporary } of bindings) temporary.setParameter("summonHeight", minY - band * 7 + value.progress * (height + 14 * band));
    frameId = schedule(tick);
  };
  frameId = schedule(tick);
  return restore;
}
