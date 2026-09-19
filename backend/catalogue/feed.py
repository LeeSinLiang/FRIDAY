"""Tier 0 stub: reads a merchant feed file shaped like a real catalogue exchange payload."""

import json
from functools import lru_cache
from pathlib import Path

from catalogue.thumbs import svg_thumb
from catalogue.types import Listing

FEED_PATH = Path(__file__).resolve().parent / "data" / "listings.json"


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
