import { useState } from "react";
import type { Listing } from "../lib/types";
import previews from "../../../shared/catalogue-thumbnails.json";

export function listingImageUrl(listing: Pick<Listing, "thumb_url" | "model_url">): string | undefined {
  // The feed's generated initial tiles are not product photographs.
  if (listing.thumb_url && !listing.thumb_url.startsWith("data:image/svg")) return listing.thumb_url;
  return listing.model_url ? (previews as Record<string, string>)[listing.model_url] : undefined;
}

export default function ListingImage({ listing }: { listing: Listing }) {
  const primary = listingImageUrl(listing);
  const fallback = listing.model_url ? (previews as Record<string, string>)[listing.model_url] : undefined;
  const [failed, setFailed] = useState<string[]>([]);
  const src = [primary, fallback].find(url => url && !failed.includes(url));
  return src
    ? <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(urls => [...urls, src])}/>
    : <span className="listing-image-unavailable">Image unavailable</span>;
}
