"""Shared catalogue contract. Mirrored by frontend/src/lib/types.ts — change both together.

Units rule: integer millimetres and integer cents everywhere. Conversion happens only in the UI.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

Category = Literal[
    "sofa", "armchair", "chair", "table", "desk", "bed",
    "shelf", "storage", "rug", "lamp", "plant", "decor",
]
CATEGORIES: tuple[str, ...] = Category.__args__

Source = Literal["ikea", "stub", "seed"]


class DimsMm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    w: StrictInt = Field(gt=0)
    d: StrictInt = Field(gt=0)
    h: StrictInt = Field(gt=0)


class Listing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    source: Source
    title: str
    category: Category
    price_cents: StrictInt = Field(ge=0)
    dims_mm: DimsMm
    model_url: str | None  # .glb, None for seed items
    thumb_url: str
    colour_hex: list[str]
    materials: list[str]


class FacetBucket(BaseModel):
    key: str
    count: int


class Facets(BaseModel):
    category: list[FacetBucket]
    price_band: list[FacetBucket]
    fits_room: int | None = None  # count of items that fit the caller's constraint


class SearchResponse(BaseModel):
    items: list[Listing]
    total: int
    facets: Facets | None = None
