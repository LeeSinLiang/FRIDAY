"""Search counts the whole catalogue and returns only what can be placed as a real 3D model.

"312 of 1,005 armchairs fit your room" must never shrink because of what we choose to show: facets,
fits_room and fits_room_of are computed over every match, and only items and total are narrowed.
"""
import os
from unittest import mock

from django.test import SimpleTestCase
from pydantic import TypeAdapter
from rest_framework.test import APIClient

from catalogue import memory
from catalogue.dsl.schema import FindClause
from catalogue.facets import HAS_MODEL_FILTER, fit_filter, hits_filter
from catalogue.feed import load_catalogue, load_listings
from catalogue.to_es_query import to_es_query

_FIND = TypeAdapter(list[FindClause])
ARMCHAIRS_THAT_FIT = [{"k": "category", "value": "armchair"}, {"k": "fits_w_max", "mm": 900}]


def find(raw):
    return _FIND.validate_python(raw)


class MemoryBackendTests(SimpleTestCase):
    def test_counting_is_untouched_and_only_the_returned_hits_are_narrowed(self):
        everything = memory.search(load_catalogue(), find(ARMCHAIRS_THAT_FIT), 24, 0)
        shown = memory.search(load_catalogue(), find(ARMCHAIRS_THAT_FIT), 24, 0, models_only=True)
        self.assertEqual(shown.facets, everything.facets, "facets, fits_room and fits_room_of describe every match")
        self.assertGreater(everything.facets.fits_room_of, 1000, "the whole 12,000-listing catalogue is still counted")
        self.assertTrue(shown.items, "at least one armchair has a model")
        self.assertTrue(all(listing.model_url for listing in shown.items))
        self.assertLess(shown.total, everything.total)
        self.assertEqual(shown.total, sum(1 for l in load_catalogue() if l.model_url and memory.matches(l, find(ARMCHAIRS_THAT_FIT))))

    def test_paging_runs_over_what_is_returned_and_total_is_what_can_be_paged(self):
        with_models = [l for l in sorted(load_catalogue(), key=lambda l: l.id) if l.model_url]
        self.assertGreaterEqual(len(with_models), 2, "need two listings with models to page over")
        pages = [memory.search(load_catalogue(), [], 1, offset, models_only=True) for offset in range(len(with_models) + 1)]
        self.assertEqual([page.items[0].id for page in pages[:-1]], [l.id for l in with_models])
        self.assertEqual(pages[-1].items, [])
        self.assertEqual({page.total for page in pages}, {len(with_models)})

    def test_off_is_exactly_the_old_behaviour(self):
        self.assertEqual(memory.search(load_listings(), [], 24, 0), memory.search(load_listings(), [], 24, 0, models_only=False))
        self.assertEqual(memory.search(load_listings(), [], 24, 0).total, len(load_listings()))


class ElasticQueryTests(SimpleTestCase):
    def test_the_model_filter_runs_after_aggregation_beside_the_width_gap(self):
        self.assertIsNone(hits_filter(None, False))
        self.assertEqual(hits_filter(900, False), fit_filter(900))
        self.assertEqual(hits_filter(None, True), HAS_MODEL_FILTER)
        self.assertEqual(hits_filter(900, True), {"bool": {"filter": [fit_filter(900), HAS_MODEL_FILTER]}})

    def test_only_post_filter_changes_so_the_same_documents_are_counted(self):
        plain = to_es_query(find(ARMCHAIRS_THAT_FIT), (), 24, 0)
        narrowed = to_es_query(find(ARMCHAIRS_THAT_FIT), (), 24, 0, models_only=True)
        self.assertEqual({k: v for k, v in narrowed.items() if k != "post_filter"},
                         {k: v for k, v in plain.items() if k != "post_filter"})
        self.assertEqual(narrowed["post_filter"], {"bool": {"filter": [fit_filter(900), HAS_MODEL_FILTER]}})
        self.assertNotIn("post_filter", to_es_query([], (), 24, 0))
        self.assertEqual(to_es_query([], (), 24, 0, models_only=True)["post_filter"], HAS_MODEL_FILTER)


class EndpointTests(SimpleTestCase):
    URL = "/api/search?category=armchair&fits_w_mm=900"

    def get(self, flag):
        env = {k: v for k, v in os.environ.items() if k not in ("SEARCH_RESULTS_REQUIRE_MODEL", "SEARCH_BACKEND")}
        with mock.patch.dict(os.environ, {**env, **({} if flag is None else {"SEARCH_RESULTS_REQUIRE_MODEL": flag})}, clear=True):
            return APIClient().get(self.URL)

    def test_on_by_default_and_one_line_turns_it_off(self):
        default, off = self.get(None), self.get("0")
        self.assertEqual((default["X-Search-Results"], off["X-Search-Results"]), ("with-model", "all"))
        self.assertTrue(all(item["model_url"] for item in default.json()["items"]))
        self.assertEqual(default.json()["total"], len(default.json()["items"]))
        self.assertGreater(off.json()["total"], default.json()["total"])
        self.assertEqual(default.json()["facets"], off.json()["facets"], "the Elastic story does not shrink")
        self.assertEqual(self.get("")["X-Search-Results"], "with-model", "an empty value in .env means the default, ON")
