// Item C inside the PlayCanvas editor: the catalogue panel, hover -> solve -> lit floor, pick up, click to place.
// Everything the port needs lives here, so the editor itself only has to mount this one component.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import { instanceFromListing } from "../region/boundary";
import { openingsFor, portalsFor } from "../region/roomOpenings";
import { useRegion } from "../region/useRegion";
import { validatePlacement } from "../scene/placement";
import { createPendingGhost, type PendingGhost } from "../scene/playcanvas/pendingGhost";
import { priceLabel } from "./price";
import { createRegionOverlay, type RegionOverlay } from "../scene/playcanvas/regionOverlay";
import type { PlayCanvasRuntime } from "../scene/playcanvas/runtime";
import type { Instance, Product, Room, SceneEdit } from "../scene/types";
import CatalogueShelf from "./CatalogueShelf";
import { saveQuietly } from "./quietSave";
import { FREE } from '../region/types';

type Props = {
  /** The engine handle, once it exists. Read lazily: the editor keeps it in a ref. */
  getRuntime: () => PlayCanvasRuntime | null;
  room: Room;
  products: Product[];
  instances: Instance[];
  ready: boolean;
  locked: boolean;
  submit: (edit: SceneEdit) => Promise<boolean>;
  /** The session's own retry and status. A save that fails uncertainly is retried from here, quietly. */
  retry: () => Promise<unknown> | undefined;
  status: string;
  onNotice?: (message: string) => void;
  shopping?: boolean;
  showShelf?: boolean;
  onCloseShelf?: () => void;
  shelfTarget?: HTMLElement | null;
  voiceRequest?: number;
  confirm?: (instance:Instance) => Promise<boolean>;
};

/** The engine's own drag threshold (interaction.ts): a press that moves this far is a look, not a click. */
const LOOK_THRESHOLD_PX = 4;

export default function SplatCatalogueLayer({ getRuntime, room, products, instances, ready, locked, submit, retry, status, onNotice, shopping = false, showShelf = true, onCloseShelf, shelfTarget, voiceRequest, confirm }: Props) {
  const [hovered, setHovered] = useState<Listing | null>(null);
  const [armed, setArmed] = useState<Listing | null>(null);
  useEffect(() => { if (!showShelf) { setHovered(null); setArmed(null); } }, [showShelf]);
  const [place, setPlace] = useState<PlaceClause[]>([]);
  const [yawChoice, setYawChoice] = useState<number | null>(null);
  const overlay = useRef<RegionOverlay | null>(null);
  const press = useRef<{ x: number; y: number; looked: boolean } | null>(null);
  const ghost = useRef<PendingGhost | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Instance | null>(null);
  const [purchase, setPurchase] = useState<Listing | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(()=>{
    if (shopping && unconfirmed && instances.some(item=>item.instanceId===unconfirmed.instanceId)) {
      ghost.current?.hide();setUnconfirmed(null);setPurchase(null);
    }
  },[shopping,unconfirmed,instances]);
  const statusNow = useRef(status);
  statusNow.current = status;
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // An unconfirmed item still stands on the floor as far as the solver is concerned.
  const standing = useMemo(() => (unconfirmed && !instances.some((i) => i.instanceId === unconfirmed.instanceId) ? [...instances, unconfirmed] : instances), [instances, unconfirmed]);
  const known = useMemo(() => (unconfirmed?.product && !products.some((p) => p.productId === unconfirmed.productId) ? [...products, unconfirmed.product] : products), [products, unconfirmed]);

  const region = useRegion(armed ?? hovered, room, known, standing, place, openingsFor(room.roomId), portalsFor(room.roomId));
  const fitting = useMemo(() => region ? region.solution.legalCounts.flatMap((count, index) => (count > 0 ? [index] : [])) : [], [region]);
  const yawIndex = yawChoice !== null && fitting.includes(yawChoice) ? yawChoice : Math.max(region?.solution.bestYawIndex ?? 0, 0);
  const owner = armed?.id ?? hovered?.id ?? null;
  useEffect(() => setYawChoice(null), [owner]);

  // The overlay belongs to one engine instance; a room change makes a new one. Latched rather than
  // keyed on `ready`, which drops while a save is being retried: exactly when the ghost must stay.
  const [engineUp, setEngineUp] = useState(false);
  useEffect(() => setEngineUp(false), [room.roomId]);
  useEffect(() => { if (ready) setEngineUp(true); }, [ready, room.roomId]);
  useEffect(() => {
    if (!engineUp) return;
    const runtime = getRuntime();
    if (!runtime) return;
    const created = createRegionOverlay(runtime);
    const createdGhost = createPendingGhost(runtime);
    overlay.current = created; ghost.current = createdGhost;
    return () => { created.dispose(); createdGhost.dispose(); overlay.current = null; ghost.current = null; };
  }, [engineUp, getRuntime, room.roomId]);

  useEffect(() => { overlay.current?.setMask(region ? region.solution.masks[yawIndex] : null); }, [region, yawIndex, engineUp]);

  // The engine reads this: with a piece in hand here, a press on the canvas is a look (interaction.ts), which is what
  // keeps drag-to-look alive while holding. Placing stays with the click handler below.
  const inHand = armed !== null;
  useEffect(() => {
    const runtime = getRuntime();
    if (!runtime || !inHand) return;
    runtime.externalHold = true;
    return () => { runtime.externalHold = false; };
  }, [inHand, getRuntime, engineUp]);

  // While an item is in hand, a click on lit floor places it. Captured before the engine's own
  // handlers so its drag and selection logic never sees a click that belongs to this placement.
  useEffect(() => {
    const canvas = getRuntime()?.canvas;
    if (!armed || !canvas || locked || !ready) return;
    const onClick = async (event: MouseEvent) => {
      event.stopPropagation(); event.preventDefault();
      // A press that travelled was a look: the click that ends it must not place anything.
      const looked = press.current?.looked ?? false;
      press.current = null;
      if (looked) return;
      const pose = overlay.current?.poseAt(event.clientX, event.clientY);
      if (!pose) return; // outside the lit region: nothing happens, and that is the message
      const instance = instanceFromListing(armed, crypto.randomUUID(), pose);
      const verdict = validatePlacement(room, [...known, instance.product!], [...standing, instance], instance.instanceId, pose);
      if (!verdict.valid) { console.error("region solver lit a pose the editor refuses", pose, verdict.reason); return; }
      const listing = armed;
      setArmed(null); setHovered(null);
      // On the floor at once, and it stays there through a storage hiccup. Only a definite refusal removes it.
      setUnconfirmed(instance); ghost.current?.show(instance.product!, pose);
      if (shopping) { setPurchase(listing); return; }
      const outcome = await saveQuietly({
        submit: () => submit({ type: "add", instance }), retry, status: () => statusNow.current,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), cancelled: () => !alive.current,
      });
      if (outcome === "cancelled") return;
      ghost.current?.hide(); setUnconfirmed(null);
      onNotice?.(outcome === "saved" ? `${listing.title} placed` : `${listing.title} could not be placed there`);
    };
    // The press itself goes through to the engine, which turns a moved press into a look (runtime.externalHold). Only the
    // click is ours, and a click that ends a drag is the end of a look, not a placement.
    const onDown = (event: PointerEvent) => { press.current = { x: event.clientX, y: event.clientY, looked: false }; };
    // Latched like the engine's gesture.moved: out and back again is still a look, however close to the start it ends.
    const onMove = (event: PointerEvent) => {
      const pressed = press.current;
      if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) >= LOOK_THRESHOLD_PX) pressed.looked = true;
    };
    canvas.addEventListener("click", onClick, true);
    canvas.addEventListener("pointerdown", onDown, true);
    canvas.addEventListener("pointermove", onMove, true);
    return () => {
      canvas.removeEventListener("click", onClick, true);
      canvas.removeEventListener("pointerdown", onDown, true);
      canvas.removeEventListener("pointermove", onMove, true);
    };
  }, [armed, getRuntime, standing, known, locked, ready, onNotice, room, submit, retry, shopping]);

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

  async function confirmPurchase() {
    if (!unconfirmed || saving) return;
    setSaving(true);
    try {
      const ok = status === 'offline' ? await retry() : await confirm?.(unconfirmed);
      if (ok || instances.some(i=>i.instanceId===unconfirmed.instanceId)) {
        ghost.current?.hide(); setUnconfirmed(null); setPurchase(null); onNotice?.('Added to cart');
      } else onNotice?.('Placement not confirmed. Check the room status and retry.');
    } finally {setSaving(false);}
  }
  function previewSuggested() {
    const mask = region?.solution.masks[yawIndex];
    if (!armed || !mask) return;
    const index = mask.data.findIndex(value=>value===FREE);
    if (index<0) return;
    const pose = {xCm:mask.originCm[0]+(index%mask.shape[0])*mask.cellSizeCm,zCm:mask.originCm[1]+Math.floor(index/mask.shape[0])*mask.cellSizeCm,yawRad:mask.yawRad};
    const instance = instanceFromListing(armed,crypto.randomUUID(),pose);
    setUnconfirmed(instance);setPurchase(armed);setArmed(null);setHovered(null);ghost.current?.show(instance.product!,pose);
  }
  function adjustPreview(axis:'xCm'|'zCm'|'yawRad',value:number) {
    if (!unconfirmed || !Number.isFinite(value)) return;
    const next = {...unconfirmed,pose:{...unconfirmed.pose,[axis]:value}};
    setUnconfirmed(next);ghost.current?.show(next.product!,next.pose);
  }
  const verdict = unconfirmed ? validatePlacement(room,known,[...instances,unconfirmed],unconfirmed.instanceId,unconfirmed.pose) : null;
  return <>
    {shelfTarget !== undefined ? shelfTarget && createPortal(<CatalogueShelf embedded active={showShelf} voiceRequest={voiceRequest} region={region} yawIndex={yawIndex} armedId={armed?.id ?? null} disabled={!ready || locked || !!unconfirmed} purchasableOnly={shopping}
      canSwitchRooms showRooms={false} onHover={setHovered} onPick={setArmed} onPlace={setPlace}/>, shelfTarget) : showShelf && <CatalogueShelf region={region} yawIndex={yawIndex} armedId={armed?.id ?? null} disabled={!ready || locked || !!unconfirmed} purchasableOnly={shopping}
      canSwitchRooms showRooms={false} onHover={setHovered} onPick={setArmed} onPlace={setPlace} onClose={onCloseShelf}/>}

    {shopping && armed && <section className="purchase-confirm" aria-label="Preview furniture"><p>Click the lit floor, or use a suggested position.</p><button className="button" disabled={!ready || locked || !fitting.length} onClick={previewSuggested}>Preview a fitting position</button><button className="button" onClick={()=>setArmed(null)}>Cancel</button></section>}
    {shopping && purchase && unconfirmed && <section className="purchase-confirm" aria-label="Confirm furniture placement">
      <p className="eyebrow">Placement preview</p><h2>{purchase.title}</h2><p>{priceLabel(purchase.price_cents, cents => `$${(cents/100).toFixed(2)} USD`)} · sandbox</p>
      <p>{purchase.dims_mm.w/10} × {purchase.dims_mm.d/10} × {purchase.dims_mm.h/10} cm</p>
      <div className="coordinate-row">{(['xCm','zCm'] as const).map(axis=><label key={axis}>{axis==='xCm'?'X':'Z'} position (cm)<input type="number" step="5" value={unconfirmed.pose[axis]} disabled={saving || locked || status!=='ready'} onChange={e=>adjustPreview(axis,Number(e.target.value))}/></label>)}</div>
      <button className="button" disabled={saving || locked || status!=='ready'} onClick={()=>adjustPreview('yawRad',unconfirmed.pose.yawRad+Math.PI/2)}>Rotate preview 90°</button>
      <p role="status">{verdict?.valid?'Fits here. Confirm to save this piece and add it to your cart.':verdict?.reason}</p>
      <button className="button confirm-primary" disabled={saving || locked || status==='conflict' || !verdict?.valid} onClick={()=>void confirmPurchase()}>{saving?'Confirming…':status==='offline'?'Retry confirmation':'Confirm placement'}</button>
      <button className="button secondary" disabled={saving || locked || status==='offline'} onClick={()=>{ghost.current?.hide();setUnconfirmed(null);setPurchase(null);}}>Cancel preview</button>
    </section>}
  </>;
}
