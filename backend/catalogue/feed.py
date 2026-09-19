"""Tier 0 stub: reads a merchant feed file shaped like a real catalogue exchange payload."""

import json
import os
from functools import lru_cache
from pathlib import Path

from catalogue.seed import generate
from catalogue.thumbs import svg_thumb
from catalogue.types import Listing

FEED_PATH = Path(__file__).resolve().parent / "data" / "listings.json"
DEFAULT_SEED_COUNT = 12000


def parse_feed(feed: dict) -> list[Listing]:
    """Validate feed items into listings, filling in a generated thumbnail when the feed has none."""
    listings = []
    for item in feed["items"]:
        thumb_url = item.get("thumb_url") or svg_thumb(item["title"], item["colour_hex"])
        listings.append(Listing.model_validate({**item, "thumb_url": thumb_url}))
    return listings


@lru_cache(maxsize=1)
def load_listings(path: Path = FEED_PATH) -> tuple[Listing, ...]:
    with open(path, encoding="utf-8") as f:
        return tuple(parse_feed(json.load(f)))


def seed_count() -> int:
    return int(os.getenv("CATALOGUE_SEED_COUNT", str(DEFAULT_SEED_COUNT)))


@lru_cache(maxsize=1)
def load_catalogue() -> tuple[Listing, ...]:
    """The full catalogue both backends serve: the hero feed plus deterministic seed listings."""
    return load_listings() + tuple(generate(seed_count()))

