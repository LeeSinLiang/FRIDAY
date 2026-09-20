// A listing whose price nobody knows carries price_cents 0 (the field is a required integer). Zero is not
// a price: it never satisfies a price filter on the server (backend/catalogue/pricing.py), and it is never
// printed as "$0" here.

export const hasPrice = (cents: number): boolean => cents > 0;

/** The price as the caller formats it, or the words a shop uses when it cannot quote one. */
export const priceLabel = (cents: number, format: (cents: number) => string): string =>
  hasPrice(cents) ? format(cents) : "price unavailable";
