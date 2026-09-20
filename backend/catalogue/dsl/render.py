"""Program -> human-readable chips. Pure. This is the only form of a Program a shopper ever sees."""

from collections.abc import Callable

from catalogue.dsl.colours import colour_name
from catalogue.dsl.schema import Program
from catalogue.dsl.units import format_cents, format_mm

GENERIC_REF = {"any_wall": "any wall", "wall": "the wall", "window": "the window",
               "door": "the door", "instance": "that item", "surface": "that surface", "compartment": "that compartment"}
REF_GROUPS = ("walls", "windows", "doors", "instances", "surfaces", "compartments")


def _labels(refs: dict | None) -> dict[str, str]:
    groups = refs or {}
    return {entry["id"]: entry["label"] for group in REF_GROUPS for entry in groups.get(group, [])
            if "label" in entry}


def _ref_text(ref, labels: dict[str, str]) -> str:
    ref_id = getattr(ref, "id", None)
    return f"the {labels[ref_id]}" if ref_id in labels else GENERIC_REF[ref.kind]


FIND_CHIPS: dict[str, Callable[[object], str]] = {
    "text": lambda c: f"“{c.q}”",
    "category": lambda c: c.value,
    "price_max": lambda c: f"under {format_cents(c.cents)}",
    "price_min": lambda c: f"over {format_cents(c.cents)}",
    "colour": lambda c: colour_name(c.hex),
    "material": lambda c: c.value,
    "fits_w_max": lambda c: f"fits a {format_mm(c.mm)} gap",
}

PLACE_CHIPS: dict[str, Callable[[object, str], str]] = {
    "near": lambda c, where: f"within {format_mm(c.mm)} of {where}" if c.mm else f"near {where}",
    "against": lambda c, where: f"against {where}",
    "distance_min": lambda c, where: f"{format_mm(c.mm)} from {where}",
    "clear": lambda c, where: f"{format_mm(c.mm)} clear of {where}",
    "on": lambda c, where: f"on {where}",
    "inside": lambda c, where: f"inside {where}",
    "not_blocking": lambda c, where: f"not blocking {where}",
}


def render(program: Program, refs: dict | None = None) -> list[str]:
    """One chip per clause, in program order.

    Args:
        program: a validated Program.
        refs: room refs as produced by room_refs(); supplies names like "north wall". Optional.
    """
    labels = _labels(refs)
    chips = [FIND_CHIPS[clause.k](clause) for clause in program.find]
    chips += [PLACE_CHIPS[clause.k](clause, _ref_text(clause.ref, labels)) for clause in program.place]
    if program.qty and program.qty > 1:
        chips.append(f"×{program.qty}")
    return chips
