// Hover -> solve, kept off the pointer's critical path. React glue only; the solving is in solve.ts.

import { useEffect, useRef, useState } from "react";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import type { Instance, Product, Room } from "../scene/types";
import type { Portal } from "./floor";
import type { Opening } from "./types";
import { listingToProduct } from "./boundary";
import { solve, type Solution } from "./solve";

const HOVER_DEBOUNCE_MS = 90;
const WORKER_GRID_POINTS = 20_000;

export type Region = { listing: Listing; product: Product; solution: Solution };

/**
 * Solve for whichever listing is current, against the room and what is already placed.
 *
 * Small rooms solve after a short debounce. Large prepared floors use a worker so their exact
 * placement mask does not block dragging, scrolling or the recording controls on the main thread.
 * Results from a stale hover are discarded.
 */
export function useRegion(listing: Listing | null, room: Room, products: Product[], instances: Instance[], place: PlaceClause[], openings?: Opening[], portals?: Portal[]): Region | null {
  const [region, setRegion] = useState<Region | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const ticket = ++latest.current;
    if (!listing) { setRegion(null); return; }
    let worker: Worker | null = null;
    const timer = setTimeout(() => {
      if (ticket !== latest.current) return;
      const product = listingToProduct(listing);
      const scene = { room, products, instances, openings, portals };
      const apply = (solution: Solution) => {
        if (ticket === latest.current) setRegion({ listing, product, solution });
      };
      const solveHere = () => apply(solve(scene, { product }, place));
      const points = (Math.floor(room.widthCm / 5) + 1) * (Math.floor(room.depthCm / 5) + 1);
      if (typeof Worker === "undefined" || points <= WORKER_GRID_POINTS) { solveHere(); return; }
      try {
        worker = new Worker(new URL("./solve.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = ({ data }: MessageEvent<{ solution?: Solution; error?: string }>) => {
          worker?.terminate(); worker = null;
          if (data.solution) apply(data.solution);
          else if (ticket === latest.current) solveHere();
        };
        worker.onerror = () => {
          worker?.terminate(); worker = null;
          if (ticket === latest.current) solveHere();
        };
        worker.postMessage({ scene, product, place });
      } catch {
        worker?.terminate(); worker = null;
        solveHere();
      }
    }, HOVER_DEBOUNCE_MS);
    return () => { clearTimeout(timer); worker?.terminate(); };
  }, [listing, room, products, instances, place, openings, portals]);

  // Never show a region for a listing that is no longer current, even for one frame.
  return region && listing && region.listing.id === listing.id ? region : null;
}
