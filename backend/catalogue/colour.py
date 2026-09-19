"""Colour matching. A colour clause means "about this colour", never an exact hex. Pure."""

# Max squared RGB distance for two colours to count as the same family.
# 60 keeps shades of one hue together (forest green ~ leaf green) without letting a dark
# colour match near-black, which 90 did.
NEAR_DISTANCE_SQ = 60 * 60


def _rgb(hex_colour: str) -> tuple[int, int, int]:
    return int(hex_colour[1:3], 16), int(hex_colour[3:5], 16), int(hex_colour[5:7], 16)


def is_near(hex_a: str, hex_b: str) -> bool:
    distance_sq = sum((a - b) ** 2 for a, b in zip(_rgb(hex_a), _rgb(hex_b)))
    return distance_sq <= NEAR_DISTANCE_SQ
