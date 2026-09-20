// THE ONLY PLACE UNITS CROSS.
//
// The catalogue and the constraint DSL are integer millimetres. The scene is centimetres.
// Neither side changes. Every mm value that enters the scene goes through mmToCm in this file,
// and nothing else in the app divides by ten.

import type { Category, Listing } from "../lib/types";
import type { PlaceClause, Ref } from "../lib/dsl/schema";
import type { Instance, Pose, Product, Room } from "../scene/types";
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

/** Catalogue listing -> scene product. The server re-derives this from its own catalogue and rejects
 *  an instance whose carried dimensions disagree, so the client cannot shrink a sofa to make it fit. */
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

/** A catalogue listing as a placeable instance, carrying its product so the scene needs no fixture entry. */
export const instanceFromListing = (listing: Listing, instanceId: string, pose: Pose): Instance =>
  ({ instanceId, productId: listing.id, pose, product: listingToProduct(listing) });

// Wall ids as the DSL emits them. The scene's Room has no named walls, so the mapping lives here:
// north is z = 0 (the scene's back wall), west is x = 0 (its side wall). Compass words, because
// "left" stops meaning anything once the camera is first-person.
export const WALL_SIDE_BY_ID: Record<string, WallSide> = { "w-n": "n", "w-e": "e", "w-s": "s", "w-w": "w" };
export const WALL_SIDES: readonly WallSide[] = ["n", "e", "s", "w"];

/**
 * Where the room's walls are, for every clause that mentions a wall.
 *
 * A fixture room is its own width and depth. A prepared room (one with `spatial`) is not: its width
 * and depth describe the whole modelled shell, adjoining spaces included, while furniture may only
 * stand in the reviewed free areas. Measuring "5 feet from any wall" to the shell would pass for the
 * wrong reason, so the walls are the edges of the free floor instead.
 *
 * DELIBERATE APPROXIMATIONS, for tonight:
 *  - The bounding box of the free areas is used, so an L-shaped floor is treated as its enclosing
 *    rectangle for wall clauses. Placement itself is still exact: that is validatePlacement's job.
 *  - Every edge counts as a wall. In the Cg Arch interior the x = 787 cm edge is really an opening
 *    into the adjoining space, not a wall. spatial.json carries no wall metadata to say so.
 */
export function wallBounds(room: Room): Rect {
  const areas = room.spatial?.freeAreas ?? [];
  if (!areas.length) return { minX: 0, maxX: room.widthCm, minZ: 0, maxZ: room.depthCm };
  return {
    minX: Math.min(...areas.map((a) => a.minXcm)), maxX: Math.max(...areas.map((a) => a.maxXcm)),
    minZ: Math.min(...areas.map((a) => a.minZcm)), maxZ: Math.max(...areas.map((a) => a.maxZcm)),
  };
}

/** Zero-thickness rectangle along the inside face of a wall. */
export function wallRect(room: Room, side: WallSide): Rect {
  const { minX, maxX, minZ, maxZ } = wallBounds(room);
  if (side === "n") return { minX, maxX, minZ, maxZ: minZ };
  if (side === "s") return { minX, maxX, minZ: maxZ, maxZ };
  if (side === "w") return { minX, maxX: minX, minZ, maxZ };
  return { minX: maxX, maxX, minZ, maxZ };
}
