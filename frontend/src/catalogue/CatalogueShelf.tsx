// The catalogue, in the room. Search or describe what you want; hover a result to see where it could
// go; pick one and click the lit floor to place it. Presentation and fetching only: solving and
// drawing live in ../region.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import type { Region } from "../region/useRegion";
import { ROOM_CHOICES, ROOM_ID } from "../scene/fixtures";
import { compileSentence, searchCatalogue, type Compiled } from "./api";
import { canListen, fetchBackend, listen, type Heard, type Listening, type TranscribeBackend, type VoicePhase } from "./transcribe";
import "./shelf.css";
import { priceLabel } from "./price";
import ListingImage from "./ListingImage";
import { browseCatalogue, type BrowseCategory } from "./browse";

type Props = {
  embedded?: boolean;
  active?: boolean;
  voiceRequest?: number;
  voiceCancelRequest?: number;
  onVoicePhaseChange?: (phase: VoicePhase) => void;
  browseCategory?: BrowseCategory | null;
  region: Region | null;
  yawIndex: number;
  armedId: string | null;
  disabled: boolean;
  /** False while the scene has unsaved edits: switching rooms reloads the page and would discard them. */
  canSwitchRooms: boolean;
  /** The room presets belong to the legacy editor. The PlayCanvas editor picks its room with ?room=. */
  showRooms?: boolean;
  purchasableOnly?: boolean;
  onHover: (listing: Listing | null) => void;
  onPick: (listing: Listing | null) => void;
  onPlace: (place: PlaceClause[]) => void;
  onClose?: () => void;
};

// Display only. Everything on the wire stays integer cents and millimetres.
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const size = (listing: Listing) => `${listing.dims_mm.w / 10} × ${listing.dims_mm.d / 10} × ${listing.dims_mm.h / 10} cm`;

// ?dev=1 shows the raw per-rotation sample counts. A shopper needs "it fits" or "it doesn't, and why";
// "8,961 spots" sounds precise and means nothing.
const DEV = new URLSearchParams(window.location.search).has("dev");
const TURNS = ["back to the north wall", "back to the west wall", "back to the south wall", "back to the east wall"];

/** "392 in the catalogue · 1 ready in 3D" when search returned fewer than it counted; the plain count otherwise. */
// In the shop a piece can be picked up if its model is deployed with the app. Its PRICE is a separate fact: a listing
// whose price nobody knows (every Amazon Berkeley Objects product) is still a real piece with a real model, so it can be
// placed and carted, and its card says "price unavailable" where the price would be.
export const canPickInShop = (listing: Pick<Listing, "model_url">): boolean => !!listing.model_url?.startsWith("/models/furniture/");

export function countLine(total: number, matches: number | null, shown: number, readyShown = 0): string {
  const plural = (n: number) => `${n.toLocaleString()} match${n === 1 ? "" : "es"}`;
  const showing = total > shown ? `, showing ${shown}` : "";
  // Models-first mode: everything is returned with the 3D ones on top, so once a listing without a model
  // is on screen, every listing with one is above it and the count is exact.
  if ((matches === null || matches <= total) && readyShown > 0 && readyShown < shown)
    return `${plural(total)} · ${readyShown.toLocaleString()} ready in 3D, shown first`;
  if (matches === null || matches <= total) return `${plural(total)}${showing}`;
  return `${plural(matches)} in the catalogue · ${total === 0 ? "none has a 3D model yet" : `${total.toLocaleString()} ready in 3D${showing}`}`;
}

function Status({ region, yawIndex, armed }: { region: Region | null; yawIndex: number; armed: boolean }) {
  if (!region) return <p className="shelf-status">Hover a piece to see where it fits.</p>;
  const { solution, product } = region;
  if (solution.bestYawIndex < 0)
    return <p className="shelf-status refused"><strong>{product.name} won’t fit</strong> — {solution.whyNothingFits}.</p>;
  const turns = solution.legalCounts.filter((count) => count > 0).length;
  return (
    <p className="shelf-status">
      <strong>{product.name} fits.</strong>{" "}
      {armed ? `Click the lit floor to place it${turns > 1 ? " · R turns it" : ""} · Esc cancels.` : "The lit floor is where it can go. Click it to pick it up."}
      {DEV && <><br /><code>{TURNS[yawIndex]}: {solution.legalCounts[yawIndex]} centres · all turns: {solution.legalCounts.join(" / ")}</code></>}
    </p>
  );
}

export default function CatalogueShelf({ embedded = false, active = true, voiceRequest = 0, voiceCancelRequest = 0, onVoicePhaseChange, browseCategory = null, region, yawIndex, armedId, disabled, canSwitchRooms, showRooms = true, purchasableOnly = false, onHover, onPick, onPlace, onClose }: Props) {
  const [sentence, setSentence] = useState("an armchair");
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  // Every match in the catalogue, which can be far more than what is returned: search counts all
  // 12,000 listings and returns only the ones that can be placed as a real 3D model.
  const [matches, setMatches] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [browse, setBrowse] = useState<{ category: BrowseCategory; items: Listing[]; total: number | null; error: string } | null>(null);
  const browsing = browseCategory !== null;
  const currentCategory = useRef(browseCategory);
  currentCategory.current = browseCategory;
  const currentBrowse = browse?.category === browseCategory ? browse : null;
  const shownItems = browsing ? currentBrowse?.items ?? [] : items;
  const shownTotal = browsing ? currentBrowse?.total ?? null : total;
  const shownError = browsing ? currentBrowse?.error ?? "" : error;
  const shownBusy = browsing ? !currentBrowse : busy;
  useEffect(() => {
    // Restore the AI request's constraints on returning; category browsing has no place clauses.
    onPlace(browseCategory ? [] : compiled?.program.place ?? []);
    if (!browseCategory) return;
    const controller = new AbortController();
    setBrowse(null);
    void browseCatalogue(browseCategory, controller.signal).then(result => {
      if (!controller.signal.aborted) setBrowse({ category: browseCategory, ...result, error: "" });
    }).catch((caught: Error) => {
      if (!controller.signal.aborted) setBrowse({ category: browseCategory, items: [], total: null, error: caught.message });
    });
    return () => controller.abort();
  }, [browseCategory]);
  const request = useRef<AbortController | null>(null);
  const [voice, setVoice] = useState<TranscribeBackend>("browser");
  const [listening, setListening] = useState<Listening | null>(null);
  const voiceSession = useRef<Listening | null>(null);
  const voiceEpoch = useRef(0);
  const voiceStarting = useRef(false);
  const [startingVoice, setStartingVoice] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [heardBy, setHeardBy] = useState<Heard | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetchBackend(controller.signal).then(setVoice); return () => controller.abort(); }, []);

  const run = async (text: string) => {
    request.current?.abort();
    const controller = (request.current = new AbortController());
    setBusy(true);
    try {
      // compile() never fails on a bad sentence: at worst it returns a plain text search.
      const result = await compileSentence(text, controller.signal);
      const found = await searchCatalogue(result.program.find, controller.signal);
      if (controller.signal.aborted) return;
      setCompiled(result); setItems(found.items); setTotal(found.total); setError("");
      setMatches(found.facets ? found.facets.category.reduce((sum, bucket) => sum + bucket.count, 0) : null);
      if (currentCategory.current === null) {
        onHover(null); // the card under the pointer is a different listing now
        onPlace(result.program.place);
      }
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError((caught as Error).message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  };
  useEffect(() => { void run(sentence); return () => request.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Speak starts recording; finish transcribes and searches, while cancel discards the recording.
  const talk = async () => {
    if (voiceSession.current) { voiceSession.current.stop(); setListening(null); setTranscribing(true); return; }
    if (voiceStarting.current) return;
    if (!canListen(voice)) { setError("Voice is unavailable in this browser. You can still type your request."); return; }
    voiceStarting.current = true; setStartingVoice(true); setError("");
    const epoch = ++voiceEpoch.current;
    try {
      const session = await listen(voice);
      // Closing or switching floors while permission is pending must release the new stream.
      if (epoch !== voiceEpoch.current) { session.cancel(); void session.result.catch(() => undefined); return; }
      voiceSession.current = session; setListening(session);
      voiceStarting.current = false; setStartingVoice(false);
      const heard = await session.result;
      if (epoch !== voiceEpoch.current) return;
      setHeardBy(heard);
      const text = heard.text.trim();
      if (text) { setSentence(text); onPick(null); void run(text); }
      else setError("Didn’t catch that. Try again, or type it.");
    } catch (caught) {
      if (epoch === voiceEpoch.current) setError((caught as Error).message);
    } finally {
      if (epoch === voiceEpoch.current) {
        voiceSession.current = null; voiceStarting.current = false;
        setListening(null); setStartingVoice(false); setTranscribing(false);
      }
    }
  };
  const cancelVoice = () => {
    voiceEpoch.current++;
    voiceStarting.current = false;
    const session = voiceSession.current;
    voiceSession.current = null;
    session?.cancel();
    void session?.result.catch(() => undefined);
    setListening(null); setStartingVoice(false); setTranscribing(false);
  };
  useEffect(() => {
    if (!active || browsing) { setListening(null); setStartingVoice(false); setTranscribing(false); }
    return () => {
      voiceEpoch.current++; voiceStarting.current = false;
      voiceSession.current?.cancel(); voiceSession.current = null;
    };
  }, [active, browsing]);
  const handledVoiceRequest = useRef(0);
  useEffect(() => {
    if (!active || browsing || voiceRequest === 0 || handledVoiceRequest.current === voiceRequest) return;
    handledVoiceRequest.current = voiceRequest;
    void talk();
  }, [voiceRequest, active, browsing]); // Explicit button/chord only, never on mount or backend changes.
  const handledCancelRequest = useRef(0);
  useEffect(() => {
    if (voiceCancelRequest === 0 || handledCancelRequest.current === voiceCancelRequest) return;
    handledCancelRequest.current = voiceCancelRequest;
    cancelVoice();
  }, [voiceCancelRequest]);
  useEffect(() => {
    if (!embedded) return;
    onVoicePhaseChange?.(!active || browsing ? "idle" : startingVoice ? "connecting" : listening ? "listening" : transcribing ? "transcribing" : "idle");
  }, [active, browsing, embedded, startingVoice, listening, transcribing, onVoicePhaseChange]);
  useEffect(() => () => onVoicePhaseChange?.("idle"), [onVoicePhaseChange]);

  const submit = (event: FormEvent) => { event.preventDefault(); onPick(null); void run(sentence); };
  const dropped = region?.solution.dropped ?? [];

  return (
    <aside className={embedded ? "shelf shelf-embedded" : "glass shelf"} aria-label={browseCategory ? `${browseCategory} catalogue` : embedded ? "AI recommendations" : "Catalogue"} onPointerLeave={() => onHover(null)}>
      {onClose && <button type="button" className="shelf-close" aria-label="Close catalogue search" onClick={()=>{onPick(null);onHover(null);onClose();}}>Close search</button>}
      {showRooms && (
        <nav className="shelf-rooms" aria-label="Room">
          {ROOM_CHOICES.map((choice) => {
            const params = new URLSearchParams(window.location.search);
            if (choice.id) params.set("room", choice.id); else params.delete("room");
            const current = choice.id === ROOM_ID;
            // Switching is a full navigation, which tears down the sync layer mid-save. Until the scene
            // is saved the other room is shown but inert, so an edit is never lost to a room switch.
            return current || canSwitchRooms
              ? <a key={choice.label} href={`?${params}`} aria-current={current ? "page" : undefined}>{choice.label}</a>
              : <span key={choice.label} aria-disabled="true" title="Saving your room first…">{choice.label}</span>;
          })}
        </nav>
      )}
      {!browsing && <><form onSubmit={submit}>
        <input value={sentence} onChange={(event) => setSentence(event.target.value)} maxLength={300}
          aria-label="Describe what you are looking for" placeholder="a reading chair by the window, under $400" />
        {!embedded && canListen(voice) && (
          <button type="button" className="mic" onClick={() => void talk()} aria-pressed={listening !== null} disabled={startingVoice}
            aria-keyshortcuts="Meta+Shift+D Control+Shift+D"
            aria-label={listening ? "Stop listening" : "Say what you are looking for"} title={listening ? "Stop listening (⌘⇧D)" : "Speak (⌘⇧D)"}>
            {listening ? "■" : <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v4m-4 0h8"/></svg>}
          </button>
        )}
        <button className="go" disabled={busy}>{busy ? "…" : "Find"}</button>
      </form>
      {compiled && compiled.chips.length > 0 && (
        <div className="shelf-chips">{compiled.chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
      )}
      {DEV && (
        <p className="shelf-status"><code>voice configured: {voice}{heardBy ? ` · last transcript ANSWERED BY: ${heardBy.answeredBy}${heardBy.note ? ` (${heardBy.note})` : ""}` : " · nothing transcribed yet"}</code></p>
      )}
      </>}
      {shownError && <p className="shelf-status refused" role="alert">{shownError}</p>}
      {/* One fixed-height slot for everything that changes on hover. The panel is bottom-anchored and usually
          at its max height, so a taller explanation used to shrink the list from the top, and the card under a
          still pointer became a different card. */}
      <div className={DEV ? "shelf-explain dev" : "shelf-explain"}>
        <Status region={region} yawIndex={yawIndex} armed={armedId !== null} />
        {dropped.length > 0 && (
          <ul className="shelf-dropped">
            {dropped.map((item, index) => <li key={index}>Couldn’t use “{item.clause.k.replace("_", " ")} {"id" in item.clause.ref && item.clause.ref.id ? item.clause.ref.id : item.clause.ref.kind.replace("_", " ")}”: {item.reason}</li>)}
          </ul>
        )}
      </div>
      <ul key={browseCategory ?? "recommendations"} className={`shelf-results${embedded ? " recommendation-cards" : ""}`} aria-label={browseCategory ? `${browseCategory} results` : "Recommended furniture"} aria-busy={shownBusy}>
        {browsing && shownBusy && <li className="shelf-empty" role="status">Loading {browseCategory.toLowerCase()}…</li>}
        {!shownBusy && shownTotal === 0 && <li className="shelf-empty">{browseCategory ? `No ${browseCategory.toLowerCase()} with 3D models yet. Choose another category.` : "No matching pieces. Try a different material, size, or budget."}</li>}
        {shownItems.map((listing) => (
          <li key={listing.id}>
            <button aria-pressed={armedId === listing.id} disabled={disabled || (purchasableOnly && !canPickInShop(listing))}
              onPointerEnter={() => onHover(listing)} onFocus={() => onHover(listing)}
              onClick={() => onPick(armedId === listing.id ? null : listing)}>
              <ListingImage listing={listing} preferModelPreview={browsing}/>
              <span className="recommendation-copy">
                <strong>{listing.title}</strong>
                <small>{priceLabel(listing.price_cents, dollars)} · {size(listing)}</small>
                {purchasableOnly && !canPickInShop(listing) && <small>No 3D model yet</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {shownTotal !== null && <p className="shelf-status">{browsing ? `${shownTotal} pieces ready in 3D${shownTotal > shownItems.length ? ` · showing first ${shownItems.length}` : ""}` : countLine(shownTotal, matches, shownItems.length, shownItems.filter((item) => item.model_url).length)}</p>}
    </aside>
  );
}
