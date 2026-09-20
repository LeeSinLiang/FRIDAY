from unittest import mock

from django.http import QueryDict
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from catalogue import memory
from catalogue.feed import load_listings
from catalogue.mock.room import MOCK_ROOM, room_refs
from catalogue.params import parse_search_params
from catalogue.types import CATEGORIES, SearchResponse


def run(**params: str) -> SearchResponse:
    query = parse_search_params(params)
    return memory.search(load_listings(), query.find, query.limit, query.offset)


class FeedTests(SimpleTestCase):
    def test_feed_has_43_listings_across_all_categories(self):
        listings = load_listings()
        self.assertGreaterEqual(len(listings), 43)  # a floor, not a pin: the feed grows as assets land, but never loses a hero item
        self.assertEqual({listing.category for listing in listings}, set(CATEGORIES))

    def test_every_listing_gets_a_generated_thumb(self):
        self.assertTrue(all(l.thumb_url.startswith("data:image/svg+xml") for l in load_listings()))


class MemorySearchTests(SimpleTestCase):
    def test_no_filters_returns_everything_paged(self):
        result = run(limit="10")
        self.assertEqual((result.total, len(result.items)), (len(load_listings()), 10))

    def test_category(self):
        self.assertEqual({i.category for i in run(category="armchair").items}, {"armchair"})

    def test_fits_w_max_narrows_armchairs(self):
        wide, narrow = run(category="armchair"), run(category="armchair", fits_w_mm="900")
        self.assertEqual((wide.total, narrow.total), (sum(l.category == "armchair" for l in load_listings()), sum(l.category == "armchair" and l.dims_mm.w <= 900 for l in load_listings())))
        self.assertTrue(all(i.dims_mm.w <= 900 for i in narrow.items))

    def test_price_range(self):
        result = run(price_min="10000", price_max="30000", limit="100")
        self.assertTrue(result.items)
        self.assertTrue(all(10000 <= i.price_cents <= 30000 for i in result.items))

    def test_results_are_ordered_by_id(self):
        ids = [i.id for i in run(limit="100").items]
        self.assertEqual(ids, sorted(ids))

    def test_text_matches_whole_title_words_and_material_substrings(self):
        self.assertEqual(run(q="win").total, 0)  # not a substring of "wing"
        self.assertIn("LISTERBY side table", {i.title for i in run(q="oak", limit="100").items})  # "oak veneer"
        self.assertEqual({i.category for i in run(q="sit stand").items}, {"desk"})  # "sit/stand"

    def test_text_matches_title_tokens(self):
        self.assertEqual([i.title for i in run(q="wing chair").items], ["STRANDMON wing chair"])

    def test_material_is_case_insensitive_substring(self):
        result = run(material="Oak", limit="100")
        self.assertTrue(result.items)
        self.assertTrue(all(any("oak" in m for m in i.materials) for i in result.items))

    def test_colour_matches_nearby_shades_not_exact_hex(self):
        titles = {i.title for i in run(colour="#2a5a4c").items}
        self.assertIn("STRANDMON wing chair", titles)
        self.assertNotIn("BILLY bookcase", titles)


class ParamTests(SimpleTestCase):
    def test_bad_values_raise(self):
        for params in ({"price_max": "cheap"}, {"category": "spaceship"}, {"colour": "green"},
                       {"limit": "0"}, {"fits_w_mm": "-5"}, {"limit": "100", "offset": "9901"}):
            with self.assertRaises(ValueError, msg=str(params)):
                parse_search_params(params)


    def test_a_repeated_param_becomes_one_clause_each(self):
        query = parse_search_params(QueryDict("material=oak&material=steel&category=desk"))
        self.assertEqual([(c.k, getattr(c, "value", None)) for c in query.find],
                         [("category", "desk"), ("material", "oak"), ("material", "steel")])

    def test_repeated_materials_are_anded(self):
        query = parse_search_params(QueryDict("material=oak&material=steel&limit=100"))
        hits = memory.search(load_listings(), query.find, query.limit, query.offset).items
        both = lambda l: any("oak" in m for m in l.materials) and any("steel" in m for m in l.materials)
        self.assertEqual([l.id for l in hits], sorted(l.id for l in load_listings() if both(l)))

    def test_deepest_allowed_page(self):
        query = parse_search_params({"limit": "100", "offset": "9900"})
        self.assertEqual((query.limit, query.offset), (100, 9900))


class SearchEndpointTests(SimpleTestCase):
    def setUp(self):
        # Hero feed only, so the expected totals stay readable.
        patcher = mock.patch("catalogue.views.load_catalogue", return_value=load_listings())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_public_and_shaped_like_search_response(self):
        response = APIClient().get("/api/search?category=armchair&fits_w_mm=900")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"items", "total", "facets"})
        self.assertEqual((body["facets"]["fits_room"], body["facets"]["fits_room_of"]), (sum(l.category == "armchair" and l.dims_mm.w <= 900 for l in load_listings()), sum(l.category == "armchair" for l in load_listings())))
        self.assertEqual(body["total"], sum(l.category == "armchair" and l.dims_mm.w <= 900 for l in load_listings()))
        SearchResponse.model_validate(body)

    def test_trailing_slash_and_bad_params(self):
        self.assertEqual(APIClient().get("/api/search/").status_code, 200)
        self.assertEqual(APIClient().get("/api/search?price_max=cheap").status_code, 400)


class MockRoomTests(SimpleTestCase):
    def test_refs_expose_expected_ids(self):
        refs = room_refs(MOCK_ROOM)
        self.assertEqual([w["id"] for w in refs["walls"]], ["w-n", "w-e", "w-s", "w-w"])
        self.assertEqual(([w["id"] for w in refs["windows"]], [d["id"] for d in refs["doors"]]), (["w1"], ["d1"]))
        self.assertEqual([i["id"] for i in refs["instances"]], ["sofa-1", "lamp-1"])
