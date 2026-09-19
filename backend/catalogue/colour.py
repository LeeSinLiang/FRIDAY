"""Colour matching. A colour clause means "about this colour", never an exact hex. Pure."""

# Max squared RGB distance for two colours to count as the same family.
# 90 per-axis-ish: wide enough that "grey" finds charcoal and light grey, tight enough to exclude beige.
NEAR_DISTANCE_SQ = 90 * 90


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    return int(hex_colour[1:3], 16), int(hex_colour[3:5], 16), int(hex_colour[5:7], 16)


def is_near(hex_a: str, hex_b: str) -> bool:
    distance_sq = sum((a - b) ** 2 for a, b in zip(_rgb(hex_a), _rgb(hex_b)))
    return distance_sq <= NEAR_DISTANCE_SQ
