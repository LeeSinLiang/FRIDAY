"""Find clauses -> Elasticsearch request body. Pure: no client, no I/O, no model.

Structured constraints go in filter context (cached, unscored). Only free text goes in must.
"""

from collections.abc import Callable, Sequence

from catalogue.colour import is_near

_WILDCARD_SPECIALS = str.maketrans({"*": r"\*", "?": r"\?", "\\": "\\\\"})


def _token_query(token: str) -> dict:
    # title is analysed text; category and materials are keywords, so they need exact terms.
    return {"bool": {"minimum_should_match": 1, "should": [
        {"match": {"title": token}},
        {"term": {"category": token}},
        {"term": {"materials": token}},
    ]}}


def _text_must(clause) -> list[dict]:
    return [_token_query(token) for token in clause.q.lower().split()]


def _colour_filter(clause, palette: Sequence[str]) -> dict:
    # colour_hex is a keyword, so "about this colour" becomes the indexed hexes close to it.
    return {"terms": {"colour_hex": sorted(h for h in set(palette) if is_near(clause.hex, h))}}


def _material_filter(clause) -> dict:
    escaped = clause.value.translate(_WILDCARD_SPECIALS)
    return {"wildcard": {"materials": {"value": f"*{escaped}*", "case_insensitive": True}}}


FILTERS: dict[str, Callable[[object], dict]] = {
    "category": lambda clause: {"term": {"category": clause.value}},
    "price_max": lambda clause: {"range": {"price_cents": {"lte": clause.cents}}},
    "price_min": lambda clause: {"range": {"price_cents": {"gte": clause.cents}}},
    "material": _material_filter,
    "fits_w_max": lambda clause: {"range": {"dims_mm.w": {"lte": clause.mm}}},
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


def to_es_query(find: Sequence, palette: Sequence[str], limit: int, offset: int) -> dict:
    """Build the full search body.

    Args:
        find: validated find clauses.
        palette: every colour hex present in the index, used to expand colour clauses.
        limit: page size.
        offset: page start.
    """
    return {
        "query": to_es_bool(find, palette),
        "from": offset,
        "size": limit,
        "track_total_hits": True,
        # id tiebreak keeps paging stable when scores tie, which is always without a text clause.
        "sort": [{"_score": "desc"}, {"id": "asc"}],
    }
