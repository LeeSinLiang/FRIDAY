// THE ONLY PLACE UNITS CROSS.
//
// The catalogue and the constraint DSL are integer millimetres. The scene is centimetres.
// Neither side changes. Every mm value that enters the scene goes through mmToCm in this file,
// and nothing else in the app divides by ten.

import type { Category, Listing } from "../lib/types";
import type { PlaceClause, Ref } from "../lib/dsl/schema";
import type { Product, Room } from "../scene/types";
import type { Rect, WallSide } from "./types";

export const mmToCm = (mm: number): number => mm / 10;

/** A place clause with its distance already in scene centimetres. */
export type PlaceCm = { k: PlaceClause["k"]; ref: Ref; cm?: number };

export function placeToCm(place: PlaceClause[]): PlaceCm[] {
  return place.map((clause) => ({
    k: clause.k,
    ref: clause.ref,
    ...("mm" in clause && clause.mm !== undefined ? { cm: mmToCm(clause.mm) } : {}),
  }));
}

// The scene's Product.kind only picks a stand-in shape when there is no model. The catalogue's 12
// categories fold onto its 3 kinds by silhouette. Neither type changes.
const KIND_BY_CATEGORY: Record<Category, Product["kind"]> = {
  sofa: "sofa", bed: "sofa",
  armchair: "chair", chair: "chair", lamp: "chair", plant: "chair",
  table: "table", desk: "table", shelf: "table", storage: "table", rug: "table", decor: "table",
};

/** Catalogue listing -> scene product. NOTE: the scene currently accepts only the products in
 *  shared/scene-fixtures.json, so the result validates here but cannot yet be saved to a scene. */
export function listingToProduct(listing: Listing): Product {
  return {
    productId: listing.id,
    name: listing.title,
    widthCm: mmToCm(listing.dims_mm.w),
    depthCm: mmToCm(listing.dims_mm.d),
    heightCm: mmToCm(listing.dims_mm.h),
    ...(listing.model_url ? { modelUrl: listing.model_url } : {}),
    color: listing.colour_hex[0] ?? "#999999",
    kind: KIND_BY_CATEGORY[listing.category],
  };
}

// Wall ids as the DSL emits them. The scene's Room has no named walls, so the mapping lives here:
// north is z = 0 (the scene's back wall), west is x = 0 (its side wall). Compass words, because
// "left" stops meaning anything once the camera is first-person.
export const WALL_SIDE_BY_ID: Record<string, WallSide> = { "w-n": "n", "w-e": "e", "w-s": "s", "w-w": "w" };
export const WALL_SIDES: readonly WallSide[] = ["n", "e", "s", "w"];

/** Zero-thickness rectangle along the inside face of a wall. */
export function wallRect(room: Room, side: WallSide): Rect {
  const { widthCm: w, depthCm: d } = room;
  if (side === "n") return { minX: 0, maxX: w, minZ: 0, maxZ: 0 };
  if (side === "s") return { minX: 0, maxX: w, minZ: d, maxZ: d };
  if (side === "w") return { minX: 0, maxX: 0, minZ: 0, maxZ: d };
  return { minX: w, maxX: w, minZ: 0, maxZ: d };
}
