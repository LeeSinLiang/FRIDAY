import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RepeatWrapping,
  SRGBColorSpace,
} from "three";

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
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const grain =
        noise(u, v, 4, seed) * 0.65 +
        noise(u, v, 12, seed + 7) * 0.25 +
        noise(u, v, 32, seed + 19) * 0.1;
      const tone = Math.round(243 + grain * 12);
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
