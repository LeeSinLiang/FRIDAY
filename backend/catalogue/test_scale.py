"""Seed catalogue and facets. No network."""

from django.test import SimpleTestCase

from catalogue import memory
from catalogue.facets import PRICE_BANDS, facets_from_aggs
from catalogue.feed import load_catalogue, load_listings
from catalogue.params import parse_search_params
from catalogue.seed import PALETTE, generate
from catalogue.types import CATEGORIES, SearchResponse, to_wire


def run(**params: str) -> SearchResponse:
    query = parse_search_params(params)
    return memory.search(load_catalogue(), query.find, query.limit, query.offset)


class SeedTests(SimpleTestCase):
    def test_generation_is_deterministic(self):
        self.assertEqual(list(generate(200)), list(generate(200)))

    def test_seeds_are_valid_marked_and_cover_every_category(self):
        seeds = list(generate(1200))
        self.assertEqual({s.source for s in seeds}, {"seed"})
        self.assertTrue(all(s.id.startswith("seed-") and s.model_url is None for s in seeds))
        self.assertEqual({s.category for s in seeds}, set(CATEGORIES))

    def test_colours_stay_inside_the_hero_palette(self):
        hero_colours = {hex_ for listing in load_listings() for hex_ in listing.colour_hex}
        self.assertEqual(set(PALETTE), hero_colours)
        self.assertLessEqual({hex_ for s in generate(3000) for hex_ in s.colour_hex}, hero_colours)

    def test_catalogue_is_hero_items_untouched_plus_seeds(self):
        catalogue = load_catalogue()
        self.assertGreater(len(catalogue), 12000)
        self.assertEqual(catalogue[:40], load_listings())
        self.assertEqual(len({listing.id for listing in catalogue}), len(catalogue))


class FacetTests(SimpleTestCase):
    def test_facets_describe_the_whole_result_set_not_the_page(self):
        result = run(limit="5")
        self.assertEqual(len(result.items), 5)
        self.assertEqual(sum(b.count for b in result.facets.category), result.total)
        self.assertEqual(sum(b.count for b in result.facets.price_band), result.total)
        self.assertEqual([b.key for b in result.facets.price_band], [key for key, _, _ in PRICE_BANDS])

    def test_category_buckets_are_ordered_by_count_then_key(self):
        buckets = run().facets.category
        self.assertEqual(buckets, sorted(buckets, key=lambda b: (-b.count, b.key)))

    def test_fits_room_is_absent_without_a_gap_and_changes_with_it(self):
        self.assertIsNone(run().facets.fits_room)
        self.assertEqual(set(to_wire(run())["facets"]), {"category", "price_band"})
        narrow, wide = run(fits_w_mm="600").facets.fits_room, run(fits_w_mm="900").facets.fits_room
        self.assertGreater(narrow, 0)
        self.assertGreater(wide, narrow)

    def test_fits_room_respects_the_other_clauses(self):
        armchairs = run(category="armchair", fits_w_mm="900")
        self.assertEqual(armchairs.facets.fits_room, armchairs.total)
        self.assertLess(armchairs.facets.fits_room, run(fits_w_mm="900").facets.fits_room)
        self.assertEqual([b.key for b in armchairs.facets.category], ["armchair"])

    def test_fits_room_of_is_the_count_before_the_gap_applies(self):
        all_armchairs = run(category="armchair").total
        fitted = run(category="armchair", fits_w_mm="900")
        self.assertEqual(fitted.facets.fits_room_of, all_armchairs)
        self.assertEqual(fitted.facets.fits_room, fitted.total)
        self.assertLess(fitted.facets.fits_room, fitted.facets.fits_room_of)
        # The denominator ignores the gap, so it does not move when the gap does.
        self.assertEqual(run(category="armchair", fits_w_mm="600").facets.fits_room_of, all_armchairs)

    def test_category_and_price_facets_describe_what_fits_not_the_candidates(self):
        fitted = run(fits_w_mm="600")
        self.assertEqual(sum(b.count for b in fitted.facets.category), fitted.facets.fits_room)
        self.assertEqual(sum(b.count for b in fitted.facets.price_band), fitted.facets.fits_room)

    def test_facets_from_aggregations_without_a_gap(self):
        facets = facets_from_aggs({
            "category": {"buckets": [{"key": "sofa", "doc_count": 7}]},
            "price_band": {"buckets": [{"key": "0-10000", "from": 0.0, "to": 10000.0, "doc_count": 3}]},
        })
        self.assertEqual(to_wire(facets), {
            "category": [{"key": "sofa", "count": 7}],
            "price_band": [{"key": "0-10000", "count": 3}],
        })

    def test_facets_from_aggregations_with_a_gap_reads_the_nested_scope(self):
        facets = facets_from_aggs({
            "fits_room_of": {"doc_count": 12},
            "fits_room": {
                "doc_count": 5,
                "category": {"buckets": [{"key": "sofa", "doc_count": 5}]},
                "price_band": {"buckets": [{"key": "0-10000", "doc_count": 5}]},
            },
        })
        self.assertEqual(to_wire(facets), {
            "category": [{"key": "sofa", "count": 5}],
            "price_band": [{"key": "0-10000", "count": 5}],
            "fits_room": 5,
            "fits_room_of": 12,
        })
