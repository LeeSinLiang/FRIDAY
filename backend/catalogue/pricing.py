"""Unknown prices. Pure.

Listing.price_cents is a required integer, so a listing whose price nobody knows carries 0 (the Amazon
Berkeley Objects listings: real products, real models, no price). Zero is NOT a price. It must never
satisfy a price filter, never be counted in a price band, and never be printed as "$0": a shop that
answers "armchairs under $400" with items it cannot price is lying about exactly the thing asked.
"""

from catalogue.types import Listing

UNKNOWN_PRICE_CENTS = 0
# Prices are whole cents, so "known" is simply "at least one cent". Used as a range bound in Elasticsearch.
MIN_KNOWN_PRICE_CENTS = 1


def has_price(listing: Listing) -> bool:
    return listing.price_cents >= MIN_KNOWN_PRICE_CENTS
