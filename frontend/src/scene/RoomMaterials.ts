import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
  type MeshStandardMaterial,
} from "three";
import { SCENE_UNIT_CM } from "./units";

// Object detail is anchored in physical meters, so scene-unit changes preserve
// the size of limestone veins and plaster variation. No time uniform: demand render.
const surfaceNoise = `
varying vec3 vAtelierPosition;
float atelierHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float atelierNoise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(atelierHash(i),atelierHash(i+vec2(1.,0.)),f.x),
    mix(atelierHash(i+vec2(0.,1.)),atelierHash(i+vec2(1.,1.)),f.x),f.y);
}
float atelierGrain(vec2 p) {
  return atelierNoise(p)*0.57+atelierNoise(p*2.17+4.1)*0.28+atelierNoise(p*5.31)*0.15;
}`;

function finish(kind: "stone" | "plaster"): MeshStandardMaterial["onBeforeCompile"] {
  return (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vAtelierPosition;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvAtelierPosition=(modelMatrix*vec4(transformed,1.0)).xyz*${(SCENE_UNIT_CM / 100).toFixed(8)};`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>\n${surfaceNoise}`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        vec2 atelierUV = ${kind === "stone" ? "vAtelierPosition.xz" : "vec2(vAtelierPosition.x + vAtelierPosition.z, vAtelierPosition.y)"};
        float atelierSoft = atelierGrain(atelierUV*2.4);
        ${kind === "stone" ? `
          float sediment=atelierGrain(vec2(atelierUV.x*0.8+atelierSoft*0.5,atelierUV.y*19.0));
          diffuseColor.rgb *= 0.94 + atelierSoft*0.065 + sediment*0.045;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.84,0.81,0.76), smoothstep(0.77,0.89,sediment)*0.2);
        ` : "diffuseColor.rgb *= 0.935 + atelierSoft*0.10;"}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+(atelierSoft-0.5)*0.08,0.4,1.0);`);
  };
}
export const stoneFinish = finish("stone");
export const plasterFinish = finish("plaster");
export const stoneProgramKey = () => "atelier-stone-v1";
export const plasterProgramKey = () => "atelier-plaster-v1";

// Smooth, periodic value noise avoids seams and keeps the grain stable at distance.
function noise(x: number, y: number, cells: number, seed: number): number {
  const hash = (a: number, b: number) => {
    let value =
      Math.imul((a % cells) + seed, 374761393) +
      Math.imul((b % cells) + seed, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  };
  const px = x * cells;
  const py = y * cells;
  const ix = Math.floor(px);
  const iy = Math.floor(py);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const fx = smooth(px - ix);
  const fy = smooth(py - iy);
  const a = hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx;
  const b = hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx;
  return a * (1 - fy) + b * fy;
}

function grainTexture(repeatX: number, repeatY: number, seed: number) {
  const size = 256;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain =
        noise(u, v, 4, seed) * 0.65 +
        noise(u, v, 12, seed + 7) * 0.25 +
        noise(u, v, 32, seed + 19) * 0.1;
      const tone = Math.round(228 + grain * 25);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = tone;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new DataTexture(pixels, size, size);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = SRGBColorSpace;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

export function useRoomTextures(
  widthCm: number,
  depthCm: number,
  heightCm: number,
) {
  const [textures, setTextures] = useState<{
    plaster: DataTexture;
    stone: DataTexture;
  } | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    const owned = {
      plaster: grainTexture(widthCm / 180, heightCm / 180, 31),
      stone: grainTexture(widthCm / 140, depthCm / 140, 89),
    };
    setTextures(owned);
    invalidate();
    // Allocate inside the effect so StrictMode replay creates fresh resources.
    // Nothing is shared with furniture, model caches, or the next mount.
    return () => {
      owned.plaster.dispose();
      owned.stone.dispose();
    };
  }, [widthCm, depthCm, heightCm, invalidate]);
  return textures;
}
