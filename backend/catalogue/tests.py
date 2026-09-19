from django.test import SimpleTestCase
from pydantic import ValidationError

from catalogue.dsl.schema import Program
from catalogue.types import Facets, Listing, SearchResponse, to_wire

LISTING = {
    "id": "ikea-291.292.29",
    "source": "ikea",
    "title": "EKTORP 3-seat sofa",
    "category": "sofa",
    "price_cents": 59900,
    "dims_mm": {"w": 2180, "d": 880, "h": 880},
    "model_url": None,
    "thumb_url": "data:image/svg+xml,",
    "colour_hex": ["#d8d2c4"],
    "materials": ["cotton"],
}


class ListingTests(SimpleTestCase):
    def test_valid_listing_round_trips(self):
        self.assertEqual(Listing.model_validate(LISTING).model_dump(), LISTING)

    def test_float_price_is_rejected(self):
        with self.assertRaises(ValidationError):
            Listing.model_validate({**LISTING, "price_cents": 599.0})

    def test_dims_are_required_integers(self):
        without_dims = {k: v for k, v in LISTING.items() if k != "dims_mm"}
        with self.assertRaises(ValidationError):
            Listing.model_validate(without_dims)
        with self.assertRaises(ValidationError):
            Listing.model_validate({**LISTING, "dims_mm": {"w": 2180.5, "d": 880, "h": 880}})


class ProgramTests(SimpleTestCase):
    def test_full_program_parses(self):
        program = Program.model_validate({
            "find": [
                {"k": "category", "value": "armchair"},
                {"k": "price_max", "cents": 40000},
            ],
            "place": [
                {"k": "near", "ref": {"kind": "window"}},
                {"k": "distance_min", "ref": {"kind": "any_wall"}, "mm": 1524},
            ],
        })
        self.assertEqual(program.find[1].cents, 40000)
        self.assertEqual(program.place[1].ref.kind, "any_wall")

    def test_unknown_clause_is_rejected(self):
        with self.assertRaises(ValidationError):
            Program.model_validate({"find": [{"k": "dims_max", "mm": 900}], "place": []})

    def test_wall_ref_requires_id(self):
        with self.assertRaises(ValidationError):
            Program.model_validate({"find": [], "place": [{"k": "against", "ref": {"kind": "wall"}}]})


def null_paths(value, path: str = "$") -> list[str]:
    if value is None:
        return [path]
    if isinstance(value, dict):
        return [p for key, child in value.items() for p in null_paths(child, f"{path}.{key}")]
    if isinstance(value, list):
        return [p for index, child in enumerate(value) for p in null_paths(child, f"{path}[{index}]")]
    return []


class WireFormatTests(SimpleTestCase):
    """The TypeScript contract says optional means absent. Nothing optional may serialize as null."""

    def test_search_response_omits_unset_optionals(self):
        bare = to_wire(SearchResponse(items=[Listing.model_validate(LISTING)], total=1))
        self.assertNotIn("facets", bare)
        with_facets = to_wire(SearchResponse(items=[], total=0, facets=Facets(category=[], price_band=[])))
        self.assertNotIn("fits_room", with_facets["facets"])
        self.assertEqual(null_paths(with_facets), [])

    def test_model_url_is_the_only_null_and_is_always_present(self):
        wire = to_wire(SearchResponse(items=[Listing.model_validate(LISTING)], total=1))
        self.assertEqual(null_paths(wire), ["$.items[0].model_url"])
        with_model = Listing.model_validate({**LISTING, "model_url": "https://cdn.example/ektorp.glb"})
        self.assertEqual(to_wire(with_model)["model_url"], "https://cdn.example/ektorp.glb")

    def test_program_omits_ref_ids_near_mm_and_qty(self):
        wire = to_wire(Program.model_validate({
            "find": [],
            "place": [
                {"k": "near", "ref": {"kind": "window"}},
                {"k": "clear", "ref": {"kind": "door"}, "mm": 750},
            ],
        }))
        self.assertEqual(null_paths(wire), [])
        self.assertEqual(wire["place"][0], {"k": "near", "ref": {"kind": "window"}})
        self.assertNotIn("qty", wire)

    def test_set_optionals_survive(self):
        wire = to_wire(Program.model_validate({
            "find": [], "qty": 2,
            "place": [{"k": "near", "ref": {"kind": "window", "id": "w1"}, "mm": 600}],
        }))
        self.assertEqual(wire["qty"], 2)
        self.assertEqual(wire["place"][0], {"k": "near", "ref": {"kind": "window", "id": "w1"}, "mm": 600})
