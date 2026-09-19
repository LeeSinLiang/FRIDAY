// DEV STUB — Saketh. The scene the dev page solves against: backend/catalogue/mock/room.py in the
// scene's centimetres, so the ids compile() emits (w-n, w1, d1, sofa-1, lamp-1) all resolve.
// The mock room is drawn y-north from a south-west origin; the scene's north is z = 0, so z = depth - y.

import type { Scene } from "./types";

export const DEV_SCENE: Scene = {
  room: { roomId: "mock-room-1", revision: 1, widthCm: 420, depthCm: 360, heightCm: 240 },
  products: [
    { productId: "ikea-291.292.29", name: "EKTORP 3-seat sofa", widthCm: 218, depthCm: 88, heightCm: 88, color: "#d8d2c4", kind: "sofa" },
    { productId: "ikea-805.109.92", name: "HEKTAR floor lamp", widthCm: 31, depthCm: 31, heightCm: 181, color: "#3d3f41", kind: "chair" },
  ],
  instances: [
    { instanceId: "sofa-1", productId: "ikea-291.292.29", pose: { xCm: 210, zCm: 310, yawRad: Math.PI } },
    { instanceId: "lamp-1", productId: "ikea-805.109.92", pose: { xCm: 390, zCm: 30, yawRad: 0 } },
  ],
  openings: [
    { id: "d1", kind: "door", wall: "w", startCm: 210, widthCm: 90, swingCm: 90 },
    { id: "w1", kind: "window", wall: "n", startCm: 130, widthCm: 160 },
  ],
};
