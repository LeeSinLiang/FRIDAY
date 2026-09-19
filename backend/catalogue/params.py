"""Query-string parameters for GET /api/search, translated into find clauses. Pure."""

from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import TypeAdapter

from catalogue.dsl.schema import FindClause

DEFAULT_LIMIT = 24
MAX_LIMIT = 100
# Elasticsearch refuses from + size beyond index.max_result_window. Both backends share the cap,
# so paging behaves the same whichever one answers.
MAX_WINDOW = 10000

# param name -> (clause kind, clause field, is integer)
PARAM_TO_CLAUSE: dict[str, tuple[str, str, bool]] = {
    "q": ("text", "q", False),
    "category": ("category", "value", False),
    "price_max": ("price_max", "cents", True),
    "price_min": ("price_min", "cents", True),
    "colour": ("colour", "hex", False),
    "material": ("material", "value", False),
    "fits_w_mm": ("fits_w_max", "mm", True),
}

_FIND_LIST = TypeAdapter(list[FindClause])


@dataclass(frozen=True)
class SearchQuery:
    find: list
    limit: int
    offset: int


def _to_int(name: str, raw: str) -> int:
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from exc


def _values(params: Mapping[str, str], name: str) -> list[str]:
    # A param may repeat (material=oak&material=steel): a Program can hold several clauses of one kind,
    # and they are ANDed. Django's QueryDict exposes repeats through getlist; a plain dict has one value.
    raw_values = params.getlist(name) if hasattr(params, "getlist") else [params.get(name) or ""]
    return [value.strip() for value in raw_values if value and value.strip()]


def parse_search_params(params: Mapping[str, str]) -> SearchQuery:
    """Build a SearchQuery from request params.

    Raises:
        ValueError: a param is malformed. pydantic.ValidationError is a ValueError subclass.
    """
    raw_clauses = []
    for name, (kind, field, is_int) in PARAM_TO_CLAUSE.items():
        for raw in _values(params, name):
            raw_clauses.append({"k": kind, field: _to_int(name, raw) if is_int else raw})
    limit = _to_int("limit", params.get("limit") or str(DEFAULT_LIMIT))
    offset = _to_int("offset", params.get("offset") or "0")
    if not 1 <= limit <= MAX_LIMIT or offset < 0:
        raise ValueError(f"limit must be 1..{MAX_LIMIT} and offset must be >= 0")
    if offset + limit > MAX_WINDOW:
        raise ValueError(f"offset + limit must be <= {MAX_WINDOW}; narrow the search instead of paging deeper")
    return SearchQuery(find=_FIND_LIST.validate_python(raw_clauses), limit=limit, offset=offset)
