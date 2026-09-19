"""Facet definitions shared by both search backends. Pure.

Facets describe the result set: every find clause applies. `fits_room` is the headline number,
how many of the matching listings are narrow enough for the caller's gap.
"""

from collections import Counter
from collections.abc import Sequence

from catalogue.types import CATEGORIES, FacetBucket, Facets, Listing

# (key, from inclusive, to exclusive) in integer cents. Keys are stable identifiers, not display text.
PRICE_BANDS: tuple[tuple[str, int, int | None], ...] = (
    ("0-10000", 0, 10000),
    ("10000-25000", 10000, 25000),
    ("25000-50000", 25000, 50000),
    ("50000-100000", 50000, 100000),
    ("100000+", 100000, None),
)


def fit_width_mm(find: Sequence) -> int | None:
    """The tightest fits_w_max in the query, or None when the caller gave no gap."""
    widths = [clause.mm for clause in find if clause.k == "fits_w_max"]
    return min(widths) if widths else None


def _band_key(price_cents: int) -> str:
    for key, low, high in PRICE_BANDS:
        if price_cents >= low and (high is None or price_cents < high):
            return key
    raise ValueError(f"no price band for {price_cents}")


def memory_facets(hits: Sequence[Listing], find: Sequence) -> Facets:
    """Facets over already-filtered hits, bucketed and ordered the way Elasticsearch returns them."""
    by_category = Counter(listing.category for listing in hits)
    by_band = Counter(_band_key(listing.price_cents) for listing in hits)
    fit_mm = fit_width_mm(find)
    return Facets(
        # terms aggregation order: count descending, then key ascending; empty buckets omitted.
        category=[FacetBucket(key=key, count=count)
                  for key, count in sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0]))],
        # range aggregation order: as declared; empty buckets kept.
        price_band=[FacetBucket(key=key, count=by_band[key]) for key, _, _ in PRICE_BANDS],
        fits_room=None if fit_mm is None else sum(l.dims_mm.w <= fit_mm for l in hits),
    )


def es_aggs(find: Sequence) -> dict:
    """The aggregations that produce the same facets inside Elasticsearch."""
    ranges = [{"key": key, "from": low, **({} if high is None else {"to": high})}
              for key, low, high in PRICE_BANDS]
    aggs = {
        "category": {"terms": {"field": "category", "size": len(CATEGORIES)}},
        "price_band": {"range": {"field": "price_cents", "keyed": False, "ranges": ranges}},
    }
    fit_mm = fit_width_mm(find)
    if fit_mm is not None:
        aggs["fits_room"] = {"filter": {"range": {"dims_mm.w": {"lte": fit_mm}}}}
    return aggs


def facets_from_aggs(aggregations: dict) -> Facets:
    fits = aggregations.get("fits_room")
    return Facets(
        category=[FacetBucket(key=b["key"], count=b["doc_count"]) for b in aggregations["category"]["buckets"]],
        price_band=[FacetBucket(key=b["key"], count=b["doc_count"])
                    for b in aggregations["price_band"]["buckets"]],
        fits_room=None if fits is None else fits["doc_count"],
    )
