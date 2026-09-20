import type { Room } from "../types";

type RGB = readonly [number, number, number];
export type FurnitureLightingProfile = {
  id: string;
  ambient: RGB;
  key: { color: RGB; intensity: number; angles: RGB };
  fill: { color: RGB; intensity: number; angles: RGB };
  /** Baked/emissive floors and splats cannot receive a normal dynamic shadow. */
  floorContact: number;
  /** Optional diffuse-only finish, never a substitute for illumination. */
  finish: number;
  shareRoomLights?: boolean;
};

const fallback: FurnitureLightingProfile = {
  id: "neutral", ambient: [0.68, 0.65, 0.60],
  key: { color: [1, 0.94, 0.85], intensity: 1.15, angles: [48, -38, 0] },
  fill: { color: [0.78, 0.87, 1], intensity: 0.45, angles: [28, 145, 0] },
  floorContact: 0, finish: 0,
};

/** Reviewed room families only; unknown assets keep the neutral material response. */
export function furnitureLightingProfile(room: Room): FurnitureLightingProfile {
  if (room.scan?.building?.sourceSha256 === "0d4d516057aa6b8e6a79cdbd0b3446432edd831a151206c2c1879e944dc87de9") return {
    id: "london-interior", ambient: [0.52, 0.48, 0.42],
    key: { color: [1, 0.87, 0.70], intensity: 0.95, angles: [62, -28, 0] },
    fill: { color: [1, 0.95, 0.88], intensity: 0.24, angles: [28, 145, 0] },
    floorContact: 0.19, finish: 0.04,
  };
  if (room.roomId === "empty-room") return { ...fallback, id: "empty-room", shareRoomLights: true };
  if (room.roomId === "cg-arch-interior" || room.roomId === "cg-arch-lightmapper-proof") return {
    // Tuned under the source RGBM bake's existing +2.96 EV / ACES2 output.
    id: "cg-arch", ambient: [0.40, 0.39, 0.37],
    key: { color: [1, 0.97, 0.91], intensity: 0.42, angles: [42, 160, 0] },
    fill: { color: [1, 0.91, 0.78], intensity: 0.15, angles: [38, -25, 0] },
    floorContact: 0.17, finish: 0.02,
  };
  if (room.roomId === "haussmann-apartment") return {
    id: "haussmann", ambient: [0.57, 0.55, 0.51],
    key: { color: [1, 0.97, 0.91], intensity: 0.80, angles: [38, -85, 0] },
    fill: { color: [1, 0.90, 0.77], intensity: 0.20, angles: [40, 95, 0] },
    floorContact: 0.17, finish: 0,
  };
  return fallback;
}
