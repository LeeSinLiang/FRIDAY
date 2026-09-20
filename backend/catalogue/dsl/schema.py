"""The constraint DSL. Closed at 13 clauses: 7 find (catalogue) + 6 place (floor).

Single definition for the model's structured output and API validation.
Mirrored by frontend/src/lib/dsl/schema.ts — change both together.

Solver invariants (inside polygon, no overlap, supported, door swing) are never clauses.
"""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StrictInt

from catalogue.types import Category


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ---- refs: things in the room a place clause can point at ----
class AnyWallRef(_Strict):
    kind: Literal["any_wall"]


class WallRef(_Strict):
    kind: Literal["wall"]
    id: str


class WindowRef(_Strict):
    kind: Literal["window"]
    id: str | None = None


class DoorRef(_Strict):
    kind: Literal["door"]
    id: str | None = None


class InstanceRef(_Strict):
    kind: Literal["instance"]
    id: str  # something already in the room


class SurfaceRef(_Strict):
    kind: Literal["surface"]
    id: str


class CompartmentRef(_Strict):
    kind: Literal["compartment"]
    id: str


Ref = Annotated[
    Union[AnyWallRef, WallRef, WindowRef, DoorRef, InstanceRef, SurfaceRef, CompartmentRef],
    Field(discriminator="kind"),
]


# ---- filters the CATALOGUE (7) ----
class TextClause(_Strict):
    k: Literal["text"]
    q: str


class CategoryClause(_Strict):
    k: Literal["category"]
    value: Category


class PriceMaxClause(_Strict):
    k: Literal["price_max"]
    cents: StrictInt = Field(ge=0)


class PriceMinClause(_Strict):
    k: Literal["price_min"]
    cents: StrictInt = Field(ge=0)


class ColourClause(_Strict):
    k: Literal["colour"]
    hex: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")


class MaterialClause(_Strict):
    k: Literal["material"]
    value: str


class FitsWMaxClause(_Strict):
    k: Literal["fits_w_max"]
    mm: StrictInt = Field(gt=0)


FindClause = Annotated[
    Union[
        TextClause, CategoryClause, PriceMaxClause, PriceMinClause,
        ColourClause, MaterialClause, FitsWMaxClause,
    ],
    Field(discriminator="k"),
]


# ---- filters the FLOOR (6) ---- consumed by the solver; just data here
class NearClause(_Strict):
    k: Literal["near"]
    ref: Ref
    mm: StrictInt | None = Field(default=None, gt=0)


class AgainstClause(_Strict):
    k: Literal["against"]
    ref: Ref


class DistanceMinClause(_Strict):
    k: Literal["distance_min"]
    ref: Ref
    mm: StrictInt = Field(gt=0)


class ClearClause(_Strict):
    k: Literal["clear"]
    ref: Ref
    mm: StrictInt = Field(gt=0)


class OnClause(_Strict):
    k: Literal["on"]
    ref: Ref


class InsideClause(_Strict):
    k: Literal["inside"]
    ref: CompartmentRef


class NotBlockingClause(_Strict):
    k: Literal["not_blocking"]
    ref: Ref


PlaceClause = Annotated[
    Union[
        NearClause, AgainstClause, DistanceMinClause,
        ClearClause, OnClause, InsideClause, NotBlockingClause,
    ],
    Field(discriminator="k"),
]


class Program(_Strict):
    find: list[FindClause]
    place: list[PlaceClause]
    qty: StrictInt | None = Field(default=None, gt=0)
