"""In-memory search backend. The default, and the demo fallback when Elasticsearch is unavailable. Pure."""

from collections.abc import Callable, Sequence

from catalogue.colour import is_near
from catalogue.types import Listing, SearchResponse


def _haystack(listing: Listing) -> str:
    return " ".join([listing.title, listing.category, *listing.materials]).lower()


def _matches_text(listing: Listing, clause) -> bool:
    haystack = _haystack(listing)
    return all(token in haystack for token in clause.q.lower().split())


MATCHERS: dict[str, Callable[[Listing, object], bool]] = {
    "text": _matches_text,
    "category": lambda listing, clause: listing.category == clause.value,
    "price_max": lambda listing, clause: listing.price_cents <= clause.cents,
    "price_min": lambda listing, clause: listing.price_cents >= clause.cents,
    "colour": lambda listing, clause: any(is_near(clause.hex, c) for c in listing.colour_hex),
    "material": lambda listing, clause: any(
        clause.value.lower() in material.lower() for material in listing.materials
    ),
    "fits_w_max": lambda listing, clause: listing.dims_mm.w <= clause.mm,
}


def matches(listing: Listing, find: Sequence) -> bool:
    return all(MATCHERS[clause.k](listing, clause) for clause in find)


def search(listings: Sequence[Listing], find: Sequence, limit: int, offset: int) -> SearchResponse:
    """Filter listings by every find clause (AND), then page. Order is feed order."""
    hits = [listing for listing in listings if matches(listing, find)]
    return SearchResponse(items=hits[offset:offset + limit], total=len(hits))
