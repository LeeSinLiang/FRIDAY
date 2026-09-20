"""Shared catalogue contract. Mirrored by frontend/src/lib/types.ts — change both together.

Units rule: integer millimetres and integer cents everywhere. Conversion happens only in the UI.

Wire rule: optional fields are omitted, never null. Serialize with to_wire(), not model_dump().
The one nullable field is Listing.model_url, which is always present.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_serializer

Category = Literal[
    "sofa", "armchair", "chair", "table", "desk", "bed",
    "shelf", "storage", "rug", "lamp", "plant", "decor",
]
CATEGORIES: tuple[str, ...] = Category.__args__

Source = Literal["ikea", "stub", "seed", "abo"]  # abo: Amazon Berkeley Objects, a real product with its own 3D model


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

    @model_serializer(mode="wrap")
    def _keep_null_model_url(self, handler) -> dict:
        # The contract is `model_url: string | null`, so it survives to_wire()'s exclude_none.
        data = handler(self)
        data.setdefault("model_url", None)
        return data


class FacetBucket(BaseModel):
    key: str
    count: int


class Facets(BaseModel):
    category: list[FacetBucket]
    price_band: list[FacetBucket]
    # "fits_room of fits_room_of fit your room". Both present only when the caller gives a gap.
    fits_room: int | None = None  # matching listings narrow enough for the gap
    fits_room_of: int | None = None  # listings matching every other clause, ignoring the gap


class SearchResponse(BaseModel):
    items: list[Listing]
    total: int
    facets: Facets | None = None


def to_wire(model: BaseModel) -> dict:
    """Serialize a contract model for JSON: optional fields that are unset are omitted, not nulled."""
    return model.model_dump(mode="json", exclude_none=True)
