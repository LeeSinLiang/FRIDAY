// DEV STUB — Saketh. Scenes the dev page and debug script solve against.
//
// compile() is still told the ids of backend/catalogue/mock/room.py (w-n, w1, d1, sofa-1, lamp-1), so
// both scenes carry those ids. DEV_SCENE puts them in the editor's 600 x 500 cm fixture room, which is
// what actually renders. MOCK_SCENE keeps the original 420 x 360 cm mock room for tests: it is small
// enough that ordinary requests cannot be met, which is worth keeping a test on.

import { ROOM } from "../scene/fixtures";
import type { Product } from "../scene/types";
import type { Scene } from "./types";

const PRODUCTS: Product[] = [
  { productId: "ikea-291.292.29", name: "EKTORP 3-seat sofa", widthCm: 218, depthCm: 88, heightCm: 88, color: "#d8d2c4", kind: "sofa" },
  { productId: "ikea-805.109.92", name: "HEKTAR floor lamp", widthCm: 31, depthCm: 31, heightCm: 181, color: "#3d3f41", kind: "chair" },
];

export const DEV_SCENE: Scene = {
  room: ROOM,
  products: PRODUCTS,
  instances: [
    { instanceId: "sofa-1", productId: "ikea-291.292.29", pose: { xCm: 300, zCm: 450, yawRad: Math.PI } },
    { instanceId: "lamp-1", productId: "ikea-805.109.92", pose: { xCm: 570, zCm: 30, yawRad: 0 } },
  ],
  openings: [
    { id: "d1", kind: "door", wall: "w", startCm: 300, widthCm: 90, swingCm: 90 },
    { id: "w1", kind: "window", wall: "n", startCm: 220, widthCm: 160 },
  ],
};

// The mock room is drawn y-north from a south-west origin; the scene's north is z = 0, so z = depth - y.
export const MOCK_SCENE: Scene = {
  room: { roomId: "mock-room-1", revision: 1, widthCm: 420, depthCm: 360, heightCm: 240 },
  products: PRODUCTS,
  instances: [
    { instanceId: "sofa-1", productId: "ikea-291.292.29", pose: { xCm: 210, zCm: 310, yawRad: Math.PI } },
    { instanceId: "lamp-1", productId: "ikea-805.109.92", pose: { xCm: 390, zCm: 30, yawRad: 0 } },
  ],
  openings: [
    { id: "d1", kind: "door", wall: "w", startCm: 210, widthCm: 90, swingCm: 90 },
    { id: "w1", kind: "window", wall: "n", startCm: 130, widthCm: 160 },
  ],
};
