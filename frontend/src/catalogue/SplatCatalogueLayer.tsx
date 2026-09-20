// Item C inside the PlayCanvas editor: the catalogue panel, hover -> solve -> lit floor, pick up, click to place.
// Everything the port needs lives here, so the editor itself only has to mount this one component.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import { instanceFromListing } from "../region/boundary";
import { openingsFor, portalsFor } from "../region/roomOpenings";
import { useRegion } from "../region/useRegion";
import { attachmentTarget, attachAt, resolveAttachments } from "../scene/supports";
import { validatePlacement } from "../scene/placement";
import { rayFromScreen } from "../scene/playcanvas/interaction";
import { pickSupport } from "../scene/playcanvas/supportPicking";
import { createPendingGhost, type PendingGhost } from "../scene/playcanvas/pendingGhost";
import { cardCopy, cardPrice } from "./cardCopy";
import { createRegionOverlay, type RegionOverlay } from "../scene/playcanvas/regionOverlay";
import type { PlayCanvasRuntime } from "../scene/playcanvas/runtime";
import type { Instance, Product, Room, SceneEdit } from "../scene/types";
import type { BrowseCategory } from "./browse";
import CatalogueShelf from "./CatalogueShelf";
import type { VoicePhase } from "./transcribe";
import type { VoiceCommand } from "./wakeVoice";
import { saveQuietly } from "./quietSave";

type Props = {
  /** The engine handle, once it exists. Read lazily: the editor keeps it in a ref. */
  getRuntime: () => PlayCanvasRuntime | null;
  room: Room;
  sceneRevision?: number;
  products: Product[];
  instances: Instance[];
  ready: boolean;
  locked: boolean;
  draftMode?: boolean;
  submit: (edit: SceneEdit) => Promise<boolean>;
  onDesign?: (text: string, signal?:AbortSignal) => Promise<string|null>;
  designMessage?: string;
  registerVoiceCommand?: (handler:VoiceCommand|null)=>void;
  /** The session's own retry and status. A save that fails uncertainly is retried from here, quietly. */
  retry: () => Promise<unknown> | undefined;
  status: string;
  onNotice?: (message: string) => void;
  shopping?: boolean;
  showShelf?: boolean;
  onCloseShelf?: () => void;
  shelfTarget?: HTMLElement | null;
  voiceRequest?: number;
  voiceCancelRequest?: number;
  onVoicePhaseChange?: (phase: VoicePhase) => void;
  browseCategory?: BrowseCategory | null;
  confirm?: (instance:Instance) => Promise<boolean>;
};

/** The engine's own drag threshold (interaction.ts): a press that moves this far is a look, not a click. */
const LOOK_THRESHOLD_PX = 4;

export default function SplatCatalogueLayer({ getRuntime, room, sceneRevision, products, instances, ready, locked, draftMode = false, submit, retry, status, onNotice, shopping = false, showShelf = true, onCloseShelf, shelfTarget, voiceRequest, voiceCancelRequest, onVoicePhaseChange, browseCategory = null, confirm, onDesign, designMessage, registerVoiceCommand }: Props) {
  const [hovered, setHovered] = useState<Listing | null>(null);
  const [armed, setArmed] = useState<Listing | null>(null);
  useEffect(() => { if (!showShelf) { setHovered(null); setArmed(null); } }, [showShelf]);
  useEffect(() => { setHovered(null); setArmed(null); }, [browseCategory, draftMode]);
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
  const supportedInstance = (listing: Listing, id: string, pose: Instance["pose"]) => {
    let instance=instanceFromListing(listing,id,pose);
    const template=region?.solution.masks[yawIndex]?.attachment;
    if (template) {
      const {parent,target,profile}=attachmentTarget(template,standing,known);
      instance={...instance,attachment:attachAt(parent,target,profile,pose)};
      instance=resolveAttachments([...standing,instance],[...known,instance.product!]).at(-1)!;
    }
    return instance;
  };
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
      const runtime = getRuntime();
      const ray = runtime && place.length === 0 ? rayFromScreen(runtime, event.clientX, event.clientY) : null;
      const picked = ray ? pickSupport(ray, standing, known, region?.solution.masks[yawIndex]?.yawRad ?? 0, true) : null;
      // Explicit on/inside clauses still use their proven region mask. Ordinary card browsing may target a reviewed
      // tabletop; an unreviewed piece never gains an invented support just because its silhouette was clicked.
      const support = picked?.attachment ? picked : null;
      const pose = support?.pose ?? overlay.current?.poseAt(event.clientX, event.clientY);
      if (!pose) return;
      let instance = support
        ? { ...instanceFromListing(armed, crypto.randomUUID(), pose), attachment: support.attachment }
        : supportedInstance(armed, crypto.randomUUID(), pose);
      if (support) instance = resolveAttachments([...standing, instance], [...known, instance.product!]).at(-1)!;
      const verdict = validatePlacement(room, [...known, instance.product!], [...standing, instance], instance.instanceId, instance.pose);
      if (!verdict.valid) { onNotice?.(verdict.reason ?? "This item does not fit there"); return; }
      const listing = armed;
      setArmed(null); setHovered(null);
      // On the floor at once, and it stays there through a storage hiccup. Only a definite refusal removes it.
      setUnconfirmed(instance); ghost.current?.show(instance.product!, instance.pose);
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
  }, [armed, getRuntime, standing, known, locked, ready, onNotice, room, submit, retry, shopping, region, yawIndex, place]);

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
  function chooseAnotherSpot() {
    if (!purchase || saving || locked || status !== 'ready') return;
    const listing = purchase;
    ghost.current?.hide(); setUnconfirmed(null); setPurchase(null); setArmed(listing); setHovered(listing);
  }
  const verdict = unconfirmed ? validatePlacement(room,known,[...instances,unconfirmed],unconfirmed.instanceId,unconfirmed.pose) : null;
  const purchasePrice = purchase ? cardPrice(purchase.price_cents) : null;
  const requestDesign = onDesign ? (text:string,signal?:AbortSignal) => {
    if (!ready) return Promise.resolve(status === "offline" ? "Room connection interrupted. Retry the connection, then ask again."
      : status === "conflict" ? "Reload the saved layout before asking the designer." : "Wait for the room to finish loading, then ask again.");
    if (locked) return Promise.resolve("Wait for the current room operation to finish, then ask again.");
    if (unconfirmed) return Promise.resolve("Confirm or cancel the current placement before asking the designer.");
    return onDesign(text,signal);
  } : undefined;
  return <>
    {shelfTarget !== undefined ? shelfTarget && createPortal(<CatalogueShelf embedded active={showShelf} browseCategory={browseCategory} voiceRequest={voiceRequest} voiceCancelRequest={voiceCancelRequest} onVoicePhaseChange={onVoicePhaseChange} roomId={room.roomId} sceneRevision={sceneRevision} region={region} yawIndex={yawIndex} armedId={armed?.id ?? null} disabled={!ready || locked || draftMode || !!unconfirmed} purchasableOnly={shopping}
      canSwitchRooms showRooms={false} onHover={setHovered} onPick={setArmed} onPlace={setPlace} designMessage={designMessage}
      onDesign={requestDesign} registerVoiceCommand={registerVoiceCommand}/>, shelfTarget) : showShelf && <CatalogueShelf roomId={room.roomId} sceneRevision={sceneRevision} region={region} yawIndex={yawIndex} armedId={armed?.id ?? null} disabled={!ready || locked || draftMode || !!unconfirmed} purchasableOnly={shopping}
      canSwitchRooms showRooms={false} onHover={setHovered} onPick={setArmed} onPlace={setPlace} onClose={onCloseShelf} designMessage={designMessage}
      onDesign={requestDesign} registerVoiceCommand={registerVoiceCommand}/>}
    {shopping && purchase && unconfirmed && <section className="purchase-confirm" aria-label="Confirm furniture for cart">
      <p className="eyebrow">Review this item</p><h2>{cardCopy(purchase).name}</h2>
      <dl className="purchase-details">
        <div><dt>Item number</dt><dd>{purchase.id}</dd></div>
        <div><dt>Provider</dt><dd>{cardCopy(purchase).provider}</dd></div>
        <div><dt>Quantity</dt><dd>1</dd></div>
        <div><dt>Item price</dt><dd>{purchasePrice ? `${purchasePrice} USD` : "Price unavailable"}</dd></div>
        <div><dt>Tax</dt><dd>Not calculated in sandbox</dd></div>
      </dl>
      <p className="purchase-note">Adding this item saves its location in the room and cart. It does not place an order.</p>
      {!verdict?.valid && <p role="alert">{verdict?.reason}</p>}
      <button className="button confirm-primary" disabled={saving || locked || status==='conflict' || !verdict?.valid} onClick={()=>void confirmPurchase()}>{saving?'Confirming…':status==='offline'?'Retry confirmation':'Add to cart'}</button>
      <button className="button secondary" disabled={saving || locked || status!=='ready'} onClick={chooseAnotherSpot}>Choose another spot</button>
      <button className="button secondary" disabled={saving || locked || status==='offline'} onClick={()=>{ghost.current?.hide();setUnconfirmed(null);setPurchase(null);}}>Cancel</button>
    </section>}
  </>;
}
