// Hover -> solve, kept off the pointer's critical path. React glue only; the solving is in solve.ts.

import { useEffect, useRef, useState } from "react";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import type { Instance, Product, Room } from "../scene/types";
import { listingToProduct } from "./boundary";
import { solve, type Solution } from "./solve";

const HOVER_DEBOUNCE_MS = 90;

export type Region = { listing: Listing; product: Product; solution: Solution };

/**
 * Solve for whichever listing is current, against the room and what is already placed.
 *
 * A solve takes 20-50 ms for four rotations, so it runs after a short debounce and its result is
 * dropped if the pointer has moved on: a hover path that trails the cursor reads as broken.
 */
export function useRegion(listing: Listing | null, room: Room, products: Product[], instances: Instance[], place: PlaceClause[]): Region | null {
  const [region, setRegion] = useState<Region | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (!listing) { setRegion(null); return; }
    const timer = setTimeout(() => {
      if (ticket !== latest.current) return;
      const product = listingToProduct(listing);
      const solution = solve({ room, products, instances }, { product }, place);
      if (ticket === latest.current) setRegion({ listing, product, solution });
    }, HOVER_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [listing, room, products, instances, place]);

  // Never show a region for a listing that is no longer current, even for one frame.
  return region && listing && region.listing.id === listing.id ? region : null;
}
