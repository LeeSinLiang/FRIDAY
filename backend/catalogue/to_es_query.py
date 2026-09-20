"""Find clauses -> Elasticsearch request body. Pure: no client, no I/O, no model.

Structured constraints go in filter context (cached, unscored). Only free text goes in must.
"""

from collections.abc import Callable, Sequence

from catalogue.colour import is_near
from catalogue.facets import MODELS_ALL, MODELS_FIRST, MODELS_ONLY, es_aggs, fit_filter, fit_width_mm, hits_filter, model_boost, without_fit
from catalogue.text import tokenize

_WILDCARD_SPECIALS = str.maketrans({"*": r"\*", "?": r"\?", "\\": "\\\\"})


def _contains(field: str, value: str) -> dict:
    escaped = value.translate(_WILDCARD_SPECIALS)
    return {"wildcard": {field: {"value": f"*{escaped}*", "case_insensitive": True}}}


def _token_query(token: str) -> dict:
    # title is analysed text. category and materials are keywords: category needs the exact term,
    # and a material like "oak veneer" should still be found by "oak".
    return {"bool": {"minimum_should_match": 1, "should": [
        {"match": {"title": token}},
        {"term": {"category": token}},
        _contains("materials", token),
    ]}}


def _text_must(clause) -> list[dict]:
    return [_token_query(token) for token in tokenize(clause.q)]


def _colour_filter(clause, palette: Sequence[str]) -> dict:
    # colour_hex is a keyword, so "about this colour" becomes the indexed hexes close to it.
    return {"terms": {"colour_hex": sorted(h for h in set(palette) if is_near(clause.hex, h))}}


FILTERS: dict[str, Callable[[object], dict]] = {
    "category": lambda clause: {"term": {"category": clause.value}},
    "price_max": lambda clause: {"range": {"price_cents": {"lte": clause.cents}}},
    "price_min": lambda clause: {"range": {"price_cents": {"gte": clause.cents}}},
    "material": lambda clause: _contains("materials", clause.value),
    "fits_w_max": lambda clause: fit_filter(clause.mm),
}


def to_es_bool(find: Sequence, palette: Sequence[str]) -> dict:
    """Build the bool query for a list of find clauses. Clauses are ANDed."""
    must: list[dict] = []
    filters: list[dict] = []
    for clause in find:
        if clause.k == "text":
            must.extend(_text_must(clause))
        elif clause.k == "colour":
            filters.append(_colour_filter(clause, palette))
        else:
            filters.append(FILTERS[clause.k](clause))
    return {"bool": {"must": must, "filter": filters}}


def to_es_query(find: Sequence, palette: Sequence[str], limit: int, offset: int, models: str = MODELS_ALL) -> dict:
    """Build the full search body.

    Args:
        find: validated find clauses.
        palette: every colour hex present in the index, used to expand colour clauses.
        limit: page size.
        offset: page start.
        models: "only" returns just the listings that have a 3D model; "first" returns everything with those
            ranked first, as a shop does with what is in stock; "all" is plain. Aggregations cover every match
            in all three.
    """
    fit_mm = fit_width_mm(find)
    after_aggs = hits_filter(fit_mm, models == MODELS_ONLY)
    query = to_es_bool(without_fit(find), palette)
    if models == MODELS_FIRST:
        # A boolean query with nothing required matches ONLY documents that satisfy an optional clause,
        # whatever minimum_should_match says, so an empty search would quietly become models-only (the live
        # index returned 7 of 12,045). Something must be required: match_all when nothing else is.
        required = query["bool"]["must"] or query["bool"]["filter"]
        query["bool"].update({"should": [model_boost()], "minimum_should_match": 0,
                              **({} if required else {"must": [{"match_all": {}}]})})
    return {
        # post_filter narrows hits AFTER aggregation and does not affect scoring, so one request both
        # counts the whole catalogue (what fits, and what it was chosen from) and returns only what
        # the shopper can be shown.
        "query": query,
        **({} if after_aggs is None else {"post_filter": after_aggs}),
        "from": offset,
        "size": limit,
        "track_total_hits": True,
        "aggs": es_aggs(find),
        # id tiebreak keeps paging stable when scores tie, which is always without a text clause.
        "sort": [{"_score": "desc"}, {"id": "asc"}],
    }
