"""Facet definitions shared by both search backends. Pure.

Facets describe the result set: every find clause applies. The headline pair is
"fits_room of fits_room_of fit your room": fits_room_of counts listings matching every clause
except the width gap, fits_room counts the ones that also fit. One request yields both.
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


def without_fit(find: Sequence) -> list:
    """The query minus its width gap: what fits_room_of counts."""
    return [clause for clause in find if clause.k != "fits_w_max"]


def fit_filter(fit_mm: int) -> dict:
    return {"range": {"dims_mm.w": {"lte": fit_mm}}}


def memory_facets(hits: Sequence[Listing], find: Sequence, candidates: int) -> Facets:
    """Facets over already-filtered hits, bucketed and ordered the way Elasticsearch returns them.

    Args:
        hits: listings matching every clause.
        find: the clauses, used to tell whether the caller gave a gap.
        candidates: how many listings match every clause except the gap.
    """
    by_category = Counter(listing.category for listing in hits)
    by_band = Counter(_band_key(listing.price_cents) for listing in hits)
    has_gap = fit_width_mm(find) is not None
    return Facets(
        # terms aggregation order: count descending, then key ascending; empty buckets omitted.
        category=[FacetBucket(key=key, count=count)
                  for key, count in sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0]))],
        # range aggregation order: as declared; empty buckets kept.
        price_band=[FacetBucket(key=key, count=by_band[key]) for key, _, _ in PRICE_BANDS],
        fits_room=len(hits) if has_gap else None,
        fits_room_of=candidates if has_gap else None,
    )


def es_aggs(find: Sequence) -> dict:
    """The aggregations that produce the same facets inside Elasticsearch.

    With a gap, the query itself excludes the width clause (it moves to post_filter), so the
    aggregation scope is every candidate. fits_room narrows that scope to what fits and carries
    the category and price facets, so they still describe the final result set.
    """
    ranges = [{"key": key, "from": low, **({} if high is None else {"to": high})}
              for key, low, high in PRICE_BANDS]
    result_facets = {
        "category": {"terms": {"field": "category", "size": len(CATEGORIES)}},
        "price_band": {"range": {"field": "price_cents", "keyed": False, "ranges": ranges}},
    }
    fit_mm = fit_width_mm(find)
    if fit_mm is None:
        return result_facets
    return {
        "fits_room_of": {"filter": {"match_all": {}}},
        "fits_room": {"filter": fit_filter(fit_mm), "aggs": result_facets},
    }


def facets_from_aggs(aggregations: dict) -> Facets:
    fits = aggregations.get("fits_room")
    scope = aggregations if fits is None else fits
    return Facets(
        category=[FacetBucket(key=b["key"], count=b["doc_count"]) for b in scope["category"]["buckets"]],
        price_band=[FacetBucket(key=b["key"], count=b["doc_count"]) for b in scope["price_band"]["buckets"]],
        fits_room=None if fits is None else fits["doc_count"],
        fits_room_of=None if fits is None else aggregations["fits_room_of"]["doc_count"],
    )
