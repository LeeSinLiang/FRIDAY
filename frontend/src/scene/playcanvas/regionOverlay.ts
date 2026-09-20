// The PlayCanvas port of frontend/src/region/FloorOverlay.tsx: a mask in, a pose out.
//
// It lives beside the engine, NOT in frontend/src/region/, which stays renderer-free. It needs the
// three things the region module's contract asks of any renderer (docs/frontend/region-solver.md):
//   1. a floor plane in scene coordinates  -> a "plane" render entity under runtime.contentRoot
//   2. a texture sampled on it             -> the mask expanded to RGBA8, nearest filtering, as the
//                                             emissive and opacity map of an unlit StandardMaterial,
//                                             so there is no custom shader to keep in step with the
//                                             engine's WebGL and WebGPU paths
//   3. a pointer raycast to the floor, cm  -> the engine's own intersectFloor()
//
// One quad, one texture. Only `free` samples are lit; `unknown` and `blocked` are fully transparent.

import * as pc from "playcanvas";
import { stateAtPoint } from "../../region/grid";
import { maskToPixels } from "../../region/maskPixels";
import { FREE, type Mask } from "../../region/types";
import type { Pose } from "../types";
import { cmToScene, sceneToCm } from "../units";
import { intersectFloor } from "./interaction";

type Runtime = { app: pc.Application; canvas: HTMLCanvasElement; camera: pc.Entity; contentRoot: pc.Entity; disposed: boolean };

const LIFT_CM = 1.2; // above the floor and the engine's own footprint overlay
const LIT = [99, 186, 140, 150] as const; // the engine's "valid" green (#63ba8c), so the two overlays read as one system

export type RegionOverlay = {
  /** Draw this mask, or nothing for null. */
  setMask(mask: Mask | null): void;
  /** The lit sample under a pointer position (client coordinates), or null. Snaps to a proven pose. */
  poseAt(clientX: number, clientY: number): Pose | null;
  dispose(): void;
};

export function createRegionOverlay(runtime: Runtime): RegionOverlay {
  const device = runtime.app.graphicsDevice;
  const material = new pc.StandardMaterial();
  material.useLighting = false;
  material.diffuse = new pc.Color(0, 0, 0);
  material.emissive = new pc.Color(1, 1, 1);
  material.blendType = pc.BLEND_NORMAL;
  material.opacityMapChannel = "a";
  material.alphaTest = 0.02; // unlit samples are discarded outright, not blended at zero
  material.depthWrite = false;
  material.cull = pc.CULLFACE_NONE;

  const entity = new pc.Entity("Placement region");
  entity.addComponent("render", { type: "plane", material, castShadows: false, receiveShadows: false });
  entity.enabled = false;
  runtime.contentRoot.addChild(entity);

  let texture: pc.Texture | null = null;
  let current: Mask | null = null;

  const upload = (mask: Mask) => {
    const [countX, countZ] = mask.shape;
    if (!texture || texture.width !== countX || texture.height !== countZ) {
      texture?.destroy();
      // Every sampling parameter is explicit: one sample is exactly one texel, no blending, no mips, no wrap.
      texture = new pc.Texture(device, { name: "placement-region", width: countX, height: countZ, format: pc.PIXELFORMAT_RGBA8,
        mipmaps: false, minFilter: pc.FILTER_NEAREST, magFilter: pc.FILTER_NEAREST, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
      material.emissiveMap = texture; material.opacityMap = texture;
    }
    // Row 0 of the texture is the room's z = 0. The engine's plane puts v = 0 on its -Z edge (PlaneGeometry
    // pushes uv (u, 1 - j/ls) while z runs from +halfExtent down), and raw pixel data is not flipped on
    // upload, so the rows go in as they are. Reversing them here once mirrored every region.
    maskToPixels(mask, LIT, texture.lock() as Uint8Array);
    texture.unlock();
    // A baked interior raises scene.exposure to its Blender value, which multiplies emissive too and
    // clips this green to white. Read at upload time because the room sets it after it loads.
    material.emissiveIntensity = 1 / Math.max(runtime.app.scene.exposure, 1e-3);
    material.update();
  };

  return {
    setMask(mask) {
      if (runtime.disposed) return;
      current = mask;
      entity.enabled = mask !== null;
      if (!mask) return;
      upload(mask);
      // One texel per grid point, so the quad overhangs the first and last point by half a cell.
      const size = mask.cellSizeCm, widthCm = mask.shape[0] * size, depthCm = mask.shape[1] * size;
      entity.setLocalPosition(cmToScene(mask.originCm[0] + widthCm / 2 - size / 2), cmToScene(LIFT_CM), cmToScene(mask.originCm[1] + depthCm / 2 - size / 2));
      entity.setLocalScale(cmToScene(widthCm), 1, cmToScene(depthCm));
    },
    poseAt(clientX, clientY) {
      const camera = runtime.camera.camera;
      if (!current || !camera) return null;
      const rect = runtime.canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      const near = camera.screenToWorld(x, y, camera.nearClip), far = camera.screenToWorld(x, y, camera.farClip);
      const direction = far.clone().sub(near).normalize();
      const hit = intersectFloor({ origin: { x: sceneToCm(near.x), y: sceneToCm(near.y), z: sceneToCm(near.z) }, direction });
      if (!hit) return null;
      const size = current.cellSizeCm, xCm = Math.round(hit.x / size) * size, zCm = Math.round(hit.z / size) * size;
      return stateAtPoint(current, xCm, zCm) === FREE ? { xCm, zCm, yawRad: current.yawRad } : null;
    },
    dispose() { entity.destroy(); texture?.destroy(); material.destroy(); },
  };
}
