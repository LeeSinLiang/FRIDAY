"""Colour words. The model is given these hexes so spoken colours land on catalogue colours. Pure."""

NAMED_COLOURS: dict[str, str] = {
    "white": "#ffffff",
    "cream": "#e9e4d8",
    "beige": "#d8d2c4",
    "tan": "#c9a77c",
    "light wood": "#d9b88a",
    "brown": "#7a5235",
    "dark brown": "#3a2c22",
    "black": "#1c1c1c",
    "charcoal": "#3c3f44",
    "grey": "#8a8d8f",
    "silver": "#c0c0c0",
    "blue": "#2e5c8a",
    "navy": "#30475e",
    # What a shopper calls HERRÅKRA's "dark yellow". Listed before "brass" (same hex) so its chip says yellow.
    "yellow": "#b08d57",
    "mustard": "#b08d57",
    "green": "#3f7d4e",
    "dark green": "#2f5d50",
    "brass": "#b08d57",
}


def _distance_sq(hex_a: str, hex_b: str) -> int:
    return sum((int(hex_a[i:i + 2], 16) - int(hex_b[i:i + 2], 16)) ** 2 for i in (1, 3, 5))


def colour_name(hex_colour: str) -> str:
    """The closest colour word, for display."""
    return min(NAMED_COLOURS, key=lambda name: _distance_sq(NAMED_COLOURS[name], hex_colour.lower()))
