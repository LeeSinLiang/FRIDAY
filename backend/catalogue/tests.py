from django.test import SimpleTestCase
from pydantic import ValidationError

from catalogue.dsl.schema import Program
from catalogue.types import Listing

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
