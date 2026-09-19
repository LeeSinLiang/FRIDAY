"""Placeholder thumbnails as SVG data URIs: no image assets, no network."""

from urllib.parse import quote

FALLBACK_HEX = "#999999"


def _initials(title: str) -> str:
    words = [word for word in title.split() if word[0].isalnum()]
    return "".join(word[0] for word in words[:2]).upper() or "?"


def _text_colour(hex_colour: str) -> str:
    red, green, blue = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    luminance = (299 * red + 587 * green + 114 * blue) // 1000
    return "#111111" if luminance > 140 else "#ffffff"


def svg_thumb(title: str, colour_hex: list[str]) -> str:
    """Build a square swatch thumbnail from the first colour and the title's initials."""
    fill = colour_hex[0] if colour_hex else FALLBACK_HEX
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">'
        f'<rect width="96" height="96" rx="8" fill="{fill}"/>'
        f'<text x="48" y="58" font-family="sans-serif" font-size="30" font-weight="700" '
        f'text-anchor="middle" fill="{_text_colour(fill)}">{_initials(title)}</text></svg>'
    )
    return "data:image/svg+xml;utf8," + quote(svg, safe="")
