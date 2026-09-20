import type { Listing } from "../lib/types";
import { cardCopy, cardPrice } from "./cardCopy";
import "./card.css";

export default function ListingCardCopy({ listing }: { listing: Listing }) {
  const { name, provider } = cardCopy(listing);
  const price = cardPrice(listing.price_cents);
  return <span className="catalogue-card-copy">
    <strong className="catalogue-card-name">{name}</strong>
    <span className="catalogue-card-footer">
      <span className="catalogue-card-provider">{provider}</span>
      {price ? <span className="catalogue-card-price">{price}{" "}<span className="catalogue-card-currency">USD</span></span>
        : <span className="catalogue-card-price-unknown">Price unavailable</span>}
    </span>
  </span>;
}
