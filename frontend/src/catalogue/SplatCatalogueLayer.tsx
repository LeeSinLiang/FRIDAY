// Item C inside the PlayCanvas editor: the catalogue panel, hover -> solve -> lit floor, pick up, click to place.
// Everything the port needs lives here, so the editor itself only has to mount this one component.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import { instanceFromListing } from "../region/boundary";
import { useRegion } from "../region/useRegion";
import { validatePlacement } from "../scene/placement";
import { createRegionOverlay, type RegionOverlay } from "../scene/playcanvas/regionOverlay";
import type { PlayCanvasRuntime } from "../scene/playcanvas/runtime";
import type { Instance, Product, Room, SceneEdit } from "../scene/types";
import CatalogueShelf from "./CatalogueShelf";

type Props = {
  /** The engine handle, once it exists. Read lazily: the editor keeps it in a ref. */
  getRuntime: () => PlayCanvasRuntime | null;
  room: Room;
  products: Product[];
  instances: Instance[];
  ready: boolean;
  locked: boolean;
  submit: (edit: SceneEdit) => Promise<boolean>;
  onNotice?: (message: string) => void;
};

export default function SplatCatalogueLayer({ getRuntime, room, products, instances, ready, locked, submit, onNotice }: Props) {
  const [hovered, setHovered] = useState<Listing | null>(null);
  const [armed, setArmed] = useState<Listing | null>(null);
  const [place, setPlace] = useState<PlaceClause[]>([]);
  const [yawChoice, setYawChoice] = useState<number | null>(null);
  const overlay = useRef<RegionOverlay | null>(null);

  const region = useRegion(armed ?? hovered, room, products, instances, place);
  const fitting = useMemo(() => region ? region.solution.legalCounts.flatMap((count, index) => (count > 0 ? [index] : [])) : [], [region]);
  const yawIndex = yawChoice !== null && fitting.includes(yawChoice) ? yawChoice : Math.max(region?.solution.bestYawIndex ?? 0, 0);
  const owner = armed?.id ?? hovered?.id ?? null;
  useEffect(() => setYawChoice(null), [owner]);

  // The overlay belongs to one engine instance; a room change makes a new one.
  useEffect(() => {
    if (!ready) return;
    const runtime = getRuntime();
    if (!runtime) return;
    const created = createRegionOverlay(runtime);
    overlay.current = created;
    return () => { created.dispose(); overlay.current = null; };
  }, [ready, getRuntime, room.roomId]);

  useEffect(() => { overlay.current?.setMask(region ? region.solution.masks[yawIndex] : null); }, [region, yawIndex, ready]);

  // While an item is in hand, a click on lit floor places it. Captured before the engine's own
  // handlers so its drag and selection logic never sees a click that belongs to this placement.
  useEffect(() => {
    const canvas = getRuntime()?.canvas;
    if (!armed || !canvas || locked) return;
    const onClick = async (event: MouseEvent) => {
      const pose = overlay.current?.poseAt(event.clientX, event.clientY);
      event.stopPropagation(); event.preventDefault();
      if (!pose) return; // outside the lit region: nothing happens, and that is the message
      const instance = instanceFromListing(armed, crypto.randomUUID(), pose);
      const verdict = validatePlacement(room, [...products, instance.product!], [...instances, instance], instance.instanceId, pose);
      if (!verdict.valid) { console.error("region solver lit a pose the editor refuses", pose, verdict.reason); return; }
      const listing = armed;
      setArmed(null); setHovered(null);
      onNotice?.(await submit({ type: "add", instance }) ? `${listing.title} placed` : `${listing.title} could not be saved yet`);
    };
    const swallow = (event: Event) => event.stopPropagation();
    canvas.addEventListener("click", onClick, true);
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) canvas.addEventListener(type, swallow, true);
    return () => {
      canvas.removeEventListener("click", onClick, true);
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) canvas.removeEventListener(type, swallow, true);
    };
  }, [armed, getRuntime, instances, locked, onNotice, products, room, submit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (event.key === "Escape") setArmed(null);
      else if (event.key.toLowerCase() === "r" && armed && fitting.length > 1) {
        event.preventDefault();
        setYawChoice(fitting[(fitting.indexOf(yawIndex) + 1) % fitting.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, fitting, yawIndex]);

  return (
    <CatalogueShelf region={region} yawIndex={yawIndex} armedId={armed?.id ?? null} disabled={!ready || locked}
      canSwitchRooms showRooms={false} onHover={setHovered} onPick={setArmed} onPlace={setPlace} />
  );
}
