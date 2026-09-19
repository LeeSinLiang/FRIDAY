"""In-memory search backend. The default, and the demo fallback when Elasticsearch is unavailable. Pure."""

from collections.abc import Callable, Sequence

from catalogue.colour import is_near
from catalogue.facets import memory_facets, without_fit
from catalogue.text import tokenize
from catalogue.types import Listing, SearchResponse


def _token_hits(listing: Listing, token: str) -> bool:
    # Same three ways a token can hit as to_es_query: a title word, the category, or part of a material.
    return (
        token in tokenize(listing.title)
        or token == listing.category
        or any(token in material.lower() for material in listing.materials)
    )


def _matches_text(listing: Listing, clause) -> bool:
    return all(_token_hits(listing, token) for token in tokenize(clause.q))


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
    """Filter listings by every find clause (AND), order by id, page, and facet the full hit set.

    Id order matches the Elasticsearch backend's tiebreak, so both backends page identically.
    """
    candidates = [listing for listing in listings if matches(listing, without_fit(find))]
    hits = sorted((listing for listing in candidates if matches(listing, find)), key=lambda l: l.id)
    return SearchResponse(items=hits[offset:offset + limit], total=len(hits),
                          facets=memory_facets(hits, find, len(candidates)))
