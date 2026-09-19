"""Synthetic listings that bring the catalogue to a realistic size. Deterministic: same count, same listings.

Hero items in data/listings.json are never touched; seeds get their own `seed-` ids and source.
Colours come from a fixed palette on purpose: the Elasticsearch colour filter expands a colour
into the indexed hexes near it, and that palette is read with a capped terms aggregation.
"""

import random
from collections.abc import Iterator
from dataclasses import dataclass

from catalogue.thumbs import svg_thumb
from catalogue.types import Listing

SEED_RNG = 2026
MM_STEP = 10
CENTS_STEP = 100

# The hero catalogue's colours. Bounded, so the index never holds more than this many hexes.
PALETTE: tuple[str, ...] = (
    "#d8d2c4", "#5b6770", "#3c3f44", "#4a4f57", "#c9a77c", "#e6e0d4", "#2f5d50", "#8a8d8f",
    "#b98b5e", "#30475e", "#e9e4d8", "#ffffff", "#d9b88a", "#2e5c8a", "#4a3626", "#1c1c1c",
    "#b78c5a", "#f1ece2", "#3a2c22", "#d6b98c", "#d8c3a0", "#2b2b2b", "#c2a878", "#3d3f41",
    "#f4f1e8", "#b08d57", "#3f7d4e", "#2f6b3c", "#7a5235", "#c0c0c0",
)

NAMES: tuple[str, ...] = (
    "ALDER", "BRISA", "CALLA", "DOVRE", "ELMA", "FJORD", "GRANA", "HOLME", "ISEN", "JUNA",
    "KELDA", "LUMA", "MORA", "NORRE", "ODDA", "PILA", "RAUMA", "SKOGA", "TORVA", "ULVA",
    "VANDA", "YSTAD", "ARLA", "BJURA", "DALSA", "ENGA", "FALKA", "GIMLE", "HAVNA", "LINDA",
)


@dataclass(frozen=True)
class CategorySpec:
    nouns: tuple[str, ...]
    materials: tuple[str, ...]
    w: tuple[int, int]
    d: tuple[int, int]
    h: tuple[int, int]
    cents: tuple[int, int]


SPECS: dict[str, CategorySpec] = {
    "sofa": CategorySpec(("2-seat sofa", "3-seat sofa", "corner sofa", "loveseat"),
                         ("polyester", "cotton", "linen", "wood", "leather"),
                         (1300, 2900), (780, 1600), (650, 950), (19900, 249900)),
    "armchair": CategorySpec(("armchair", "wing chair", "reading chair", "lounge chair"),
                             ("polyester", "cotton", "birch", "oak", "leather"),
                             (600, 1200), (650, 1000), (720, 1080), (7900, 89900)),
    "chair": CategorySpec(("dining chair", "chair", "stool", "bar stool"),
                          ("ash", "oak", "steel", "polypropylene", "beech"),
                          (340, 560), (380, 580), (450, 1100), (1500, 29900)),
    "table": CategorySpec(("dining table", "coffee table", "side table", "console table"),
                          ("oak veneer", "ash", "particleboard", "glass", "steel"),
                          (400, 2400), (400, 1100), (400, 780), (2900, 129900)),
    "desk": CategorySpec(("desk", "sit/stand desk", "writing desk", "corner desk"),
                         ("particleboard", "steel", "bamboo", "oak veneer"),
                         (900, 2000), (500, 900), (720, 1250), (6900, 99900)),
    "bed": CategorySpec(("twin bed frame", "queen bed frame", "king bed frame", "daybed"),
                        ("pine", "particleboard", "steel", "oak", "polyester"),
                        (950, 2100), (1950, 2200), (350, 1300), (8900, 159900)),
    "shelf": CategorySpec(("bookcase", "shelf unit", "wall shelf", "display shelf"),
                          ("particleboard", "pine", "steel", "oak veneer", "glass"),
                          (300, 1800), (200, 450), (50, 2300), (1900, 69900)),
    "storage": CategorySpec(("dresser", "wardrobe", "TV unit", "cabinet", "sideboard"),
                            ("particleboard", "pine", "steel", "glass", "fibreboard"),
                            (400, 2500), (300, 650), (380, 2400), (4900, 149900)),
    "rug": CategorySpec(("rug, low pile", "rug, high pile", "rug, flatwoven", "runner"),
                        ("wool", "jute", "polypropylene", "cotton"),
                        (600, 3000), (900, 4000), (10, 40), (1900, 99900)),
    "lamp": CategorySpec(("floor lamp", "table lamp", "work lamp", "reading lamp"),
                         ("steel", "aluminium", "glass", "brass", "paper"),
                         (120, 600), (120, 600), (250, 1900), (1500, 39900)),
    "plant": CategorySpec(("potted plant", "artificial plant", "plant with pot"),
                          ("live plant", "plastic", "polyethylene", "ceramic"),
                          (150, 900), (150, 900), (200, 2000), (900, 19900)),
    "decor": CategorySpec(("mirror", "picture with frame", "vase", "wall clock"),
                          ("glass", "aluminium", "canvas", "walnut veneer", "ceramic"),
                          (150, 1600), (20, 300), (150, 1800), (900, 49900)),
}


def _stepped(rng: random.Random, bounds: tuple[int, int], step: int) -> int:
    low, high = bounds
    return rng.randrange(low // step, high // step + 1) * step


def _make(rng: random.Random, number: int, category: str) -> Listing:
    spec = SPECS[category]
    colours = rng.sample(PALETTE, rng.choice((1, 1, 2)))
    title = f"{rng.choice(NAMES)} {rng.choice(spec.nouns)}"
    return Listing(
        id=f"seed-{number:06d}",
        source="seed",
        title=title,
        category=category,
        price_cents=_stepped(rng, spec.cents, CENTS_STEP) - 1,
        dims_mm={"w": _stepped(rng, spec.w, MM_STEP), "d": _stepped(rng, spec.d, MM_STEP),
                 "h": _stepped(rng, spec.h, MM_STEP)},
        model_url=None,
        thumb_url=svg_thumb(title, colours),
        colour_hex=colours,
        materials=sorted(rng.sample(spec.materials, rng.choice((1, 2, 2, 3)))),
    )


def generate(count: int) -> Iterator[Listing]:
    """Yield `count` seed listings, cycling through categories so every category scales evenly."""
    rng = random.Random(SEED_RNG)
    categories = tuple(SPECS)
    for number in range(1, count + 1):
        yield _make(rng, number, categories[number % len(categories)])
