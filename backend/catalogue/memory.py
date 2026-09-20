"""In-memory search backend. The default, and the demo fallback when Elasticsearch is unavailable. Pure."""

from collections.abc import Callable, Sequence

from catalogue.colour import is_near
from catalogue.facets import MODELS_ALL, MODELS_FIRST, MODELS_ONLY, memory_facets, without_fit
from catalogue.pricing import has_price
from catalogue.text import title_words, tokenize
from catalogue.types import Listing, SearchResponse


def _token_hits(listing: Listing, token: str) -> bool:
    # Same three ways a token can hit as to_es_query: a title word, the category, or part of a material.
    return (
        token in title_words(listing.title)
        or token == listing.category
        or any(token in material.lower() for material in listing.materials)
    )


def _matches_text(listing: Listing, clause) -> bool:
    return all(_token_hits(listing, token) for token in tokenize(clause.q))


MATCHERS: dict[str, Callable[[Listing, object], bool]] = {
    "text": _matches_text,
    "category": lambda listing, clause: listing.category == clause.value,
    # An unknown price (0) satisfies neither: "under $400" is a claim about a price we would have to know.
    "price_max": lambda listing, clause: has_price(listing) and listing.price_cents <= clause.cents,
    "price_min": lambda listing, clause: has_price(listing) and listing.price_cents >= clause.cents,
    "colour": lambda listing, clause: any(is_near(clause.hex, c) for c in listing.colour_hex),
    "material": lambda listing, clause: any(
        clause.value.lower() in material.lower() for material in listing.materials
    ),
    "fits_w_max": lambda listing, clause: listing.dims_mm.w <= clause.mm,
}


def matches(listing: Listing, find: Sequence) -> bool:
    return all(MATCHERS[clause.k](listing, clause) for clause in find)


def search(listings: Sequence[Listing], find: Sequence, limit: int, offset: int,
           models: str = MODELS_ALL) -> SearchResponse:
    """Filter listings by every find clause (AND), order by id, page, and facet the full hit set.

    Id order matches the Elasticsearch backend's tiebreak, so both backends page identically.
    models="only": items and total cover only listings that have a 3D model, exactly as Elasticsearch's
    post_filter does. models="first": everything is returned, listings with a model ahead of the rest.
    The facets describe every match in every mode.
    """
    candidates = [listing for listing in listings if matches(listing, without_fit(find))]
    hits = sorted((listing for listing in candidates if matches(listing, find)), key=lambda l: l.id)
    returned = [listing for listing in hits if listing.model_url] if models == MODELS_ONLY else hits
    if models == MODELS_FIRST:
        returned = sorted(hits, key=lambda l: (not l.model_url, l.id))  # stable: id order inside each group
    return SearchResponse(items=returned[offset:offset + limit], total=len(returned),
                          facets=memory_facets(hits, find, len(candidates)))
