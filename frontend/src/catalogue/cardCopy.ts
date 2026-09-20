import copy from "../../../shared/catalogue-card-copy.json";
import type { Listing } from "../lib/types";
import { hasPrice } from "./price";

type CardCopy = { name: string; provider: string };
const byId: Record<string, { name: string }> = copy;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Display text only. The original listing still owns dimensions, identity, price and placement. */
export function cardCopy(listing: Pick<Listing, "id" | "title"> & Partial<Pick<Listing, "source">>): CardCopy {
  const provider = listing.source === "ikea" ? "IKEA"
    : listing.source === "stub" ? "FRIDAY demo"
    : listing.source === "seed" ? "Sample catalogue"
    : /^(Stone & Beam|Ravenna Home|AmazonBasics|Rivet)\b/i.exec(listing.title)?.[1] ?? "Amazon";
  if (Object.hasOwn(byId, listing.id)) return { name: byId[listing.id].name, provider };
  // Other search results retain factual title words, without the merchant's size suffix or brand boilerplate.
  const title = listing.title.replace(/^(?:Rivet|Stone & Beam|Ravenna Home|AmazonBasics)\s+/i, "")
    .split(/,|\s+-\s+\d/)[0].trim();
  const words = title.split(/\s+/);
  const name = words.length > 7 ? `${words.slice(0, 7).join(" ")}…` : title;
  return { name, provider };
}

export function cardPrice(cents: number): string | null {
  return Number.isFinite(cents) && hasPrice(cents) ? usd.format(cents / 100) : null;
}
