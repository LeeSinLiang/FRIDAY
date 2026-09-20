// A mask as RGBA8 pixels for a renderer's texture. Pure: no renderer import.
//
// ROW ORDER IS THE WHOLE POINT OF THIS FILE. Pixel row iz is mask row iz: row 0 is the room's z = 0.
// A renderer must map its texture so that row 0 lands on z = 0, and must NOT reverse the rows to
// compensate for a guess about its plane's UVs. The PlayCanvas overlay once did, and drew every
// region mirrored front to back: invisible in a symmetric room or for a large region (which overlaps
// its own mirror), but the small hero patch was drawn where a click did nothing, while the floor that
// did accept the click showed no green. It was caught in the top view, by clicking.

import { FREE, type Mask } from "./types";

export type Rgba = readonly [number, number, number, number];

/** Only free samples are lit; unknown and blocked stay fully transparent. */
export function maskToPixels(mask: Mask, lit: Rgba, into?: Uint8Array): Uint8Array {
  const [countX, countZ] = mask.shape;
  const pixels = into ?? new Uint8Array(countX * countZ * 4);
  if (pixels.length !== countX * countZ * 4) throw new Error("Pixel buffer does not match the mask's shape");
  pixels.fill(0);
  for (let iz = 0; iz < countZ; iz++) for (let ix = 0; ix < countX; ix++) {
    if (mask.data[iz * countX + ix] !== FREE) continue;
    pixels.set(lit, (iz * countX + ix) * 4);
  }
  return pixels;
}
