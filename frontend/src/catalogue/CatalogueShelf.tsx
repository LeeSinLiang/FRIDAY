// The catalogue, in the room. Search or describe what you want; hover a result to see where it could
// go; pick one and click the lit floor to place it. Presentation and fetching only: solving and
// drawing live in ../region.

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PlaceClause } from "../lib/dsl/schema";
import type { Listing } from "../lib/types";
import type { Region } from "../region/useRegion";
import { ROOM_CHOICES, ROOM_ID } from "../scene/fixtures";
import { compileSentence, searchCatalogue, type Compiled } from "./api";
import "./shelf.css";

type Props = {
  region: Region | null;
  yawIndex: number;
  armedId: string | null;
  disabled: boolean;
  onHover: (listing: Listing | null) => void;
  onPick: (listing: Listing | null) => void;
  onPlace: (place: PlaceClause[]) => void;
};

// Display only. Everything on the wire stays integer cents and millimetres.
const dollars = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const size = (listing: Listing) => `${listing.dims_mm.w / 10} × ${listing.dims_mm.d / 10} × ${listing.dims_mm.h / 10} cm`;

// ?dev=1 shows the raw per-rotation sample counts. A shopper needs "it fits" or "it doesn't, and why";
// "8,961 spots" sounds precise and means nothing.
const DEV = new URLSearchParams(window.location.search).has("dev");
const TURNS = ["back to the north wall", "back to the west wall", "back to the south wall", "back to the east wall"];

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

export default function CatalogueShelf({ region, yawIndex, armedId, disabled, onHover, onPick, onPlace }: Props) {
  const [sentence, setSentence] = useState("an armchair");
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [items, setItems] = useState<Listing[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);

  const run = async (text: string) => {
    request.current?.abort();
    const controller = (request.current = new AbortController());
    setBusy(true);
    try {
      // compile() never fails on a bad sentence: at worst it returns a plain text search.
      const result = await compileSentence(text, controller.signal);
      const found = await searchCatalogue(result.program.find, controller.signal);
      setCompiled(result); setItems(found.items); setTotal(found.total); setError("");
      onHover(null); // the card under the pointer is a different listing now
      onPlace(result.program.place);
    } catch (caught) {
      if ((caught as Error).name !== "AbortError") setError((caught as Error).message);
    } finally {
      if (request.current === controller) setBusy(false);
    }
  };
  useEffect(() => { void run(sentence); return () => request.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = (event: FormEvent) => { event.preventDefault(); onPick(null); void run(sentence); };
  const dropped = region?.solution.dropped ?? [];

  return (
    <aside className="glass shelf" aria-label="Catalogue" onPointerLeave={() => onHover(null)}>
      <nav className="shelf-rooms" aria-label="Room">
        {ROOM_CHOICES.map((choice) => {
          const params = new URLSearchParams(window.location.search);
          if (choice.id) params.set("room", choice.id); else params.delete("room");
          return <a key={choice.label} href={`?${params}`} aria-current={choice.id === ROOM_ID ? "page" : undefined}>{choice.label}</a>;
        })}
      </nav>
      <form onSubmit={submit}>
        <input value={sentence} onChange={(event) => setSentence(event.target.value)} maxLength={300}
          aria-label="Describe what you are looking for" placeholder="a reading chair by the window, under $400" />
        <button className="go" disabled={busy}>{busy ? "…" : "Find"}</button>
      </form>
      {compiled && compiled.chips.length > 0 && (
        <div className="shelf-chips">{compiled.chips.map((chip) => <span key={chip}>{chip}</span>)}</div>
      )}
      {error && <p className="shelf-status refused" role="alert">{error}</p>}
      <Status region={region} yawIndex={yawIndex} armed={armedId !== null} />
      {dropped.length > 0 && (
        <ul className="shelf-dropped">
          {dropped.map((item, index) => <li key={index}>Couldn’t use “{item.clause.k.replace("_", " ")} {"id" in item.clause.ref && item.clause.ref.id ? item.clause.ref.id : item.clause.ref.kind.replace("_", " ")}”: {item.reason}</li>)}
        </ul>
      )}
      <ul className="shelf-results">
        {items.map((listing) => (
          <li key={listing.id}>
            <button aria-pressed={armedId === listing.id} disabled={disabled}
              onPointerEnter={() => onHover(listing)} onFocus={() => onHover(listing)}
              onClick={() => onPick(armedId === listing.id ? null : listing)}>
              <img src={listing.thumb_url} alt="" />
              <span>
                <strong>{listing.title}</strong>
                <small>{dollars(listing.price_cents)} · {size(listing)}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total !== null && <p className="shelf-status">{total.toLocaleString()} match{total === 1 ? "" : "es"}{total > items.length ? `, showing ${items.length}` : ""}</p>}
    </aside>
  );
}
