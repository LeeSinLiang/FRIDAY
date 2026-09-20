"""A price of 0 means "nobody knows", not "free". It must never satisfy a price filter, never be counted
in a price band, and never be shown as $0.

The cases replay what the asset lane probed before this rule existed: one sofa at price_cents 0 was
returned by price_max=40000, moved the 0-10000 band from 0 to 1, and its card read "$0".
"""
import os
import unittest

from django.test import SimpleTestCase
from pydantic import TypeAdapter

from catalogue import memory
from catalogue.dsl.schema import FindClause
from catalogue.facets import PRICE_BANDS, es_aggs, memory_facets
from catalogue.feed import load_listings
from catalogue.pricing import MIN_KNOWN_PRICE_CENTS, UNKNOWN_PRICE_CENTS, has_price
from catalogue.to_es_query import to_es_bool

_FIND = TypeAdapter(list[FindClause])


def find(raw):
    return _FIND.validate_python(raw)


def with_an_unpriced_sofa():
    """The hero feed plus one sofa, identical to a real one except that its price is unknown."""
    listings = list(load_listings())
    real = next(l for l in listings if l.category == "sofa")
    return listings, real.model_copy(update={"id": "abo-unpriced-sofa", "title": "Unpriced sofa", "price_cents": UNKNOWN_PRICE_CENTS})


class MemoryTests(SimpleTestCase):
    def setUp(self):
        self.listings, self.unpriced = with_an_unpriced_sofa()
        self.everything = self.listings + [self.unpriced]

    def ids(self, raw):
        return {l.id for l in memory.search(self.everything, find(raw), 500, 0).items}

    def test_an_unknown_price_satisfies_no_price_clause_in_either_direction(self):
        self.assertFalse(has_price(self.unpriced))
        self.assertNotIn(self.unpriced.id, self.ids([{"k": "price_max", "cents": 40000}]), "0 is not 'under $400'")
        self.assertNotIn(self.unpriced.id, self.ids([{"k": "price_max", "cents": 1}]))
        self.assertNotIn(self.unpriced.id, self.ids([{"k": "price_min", "cents": 0}]), "nor is it 'at least $0'")
        self.assertNotIn(self.unpriced.id, self.ids([{"k": "category", "value": "sofa"}, {"k": "price_max", "cents": 10_000_000}]))

    def test_it_is_still_a_sofa_and_still_found_without_a_price_clause(self):
        self.assertIn(self.unpriced.id, self.ids([{"k": "category", "value": "sofa"}]))
        self.assertIn(self.unpriced.id, self.ids([]))

    def test_priced_listings_are_untouched(self):
        for raw in ([{"k": "price_max", "cents": 40000}], [{"k": "price_min", "cents": 40000}], []):
            before = memory.search(self.listings, find(raw), 500, 0)
            after = memory.search(self.everything, find(raw), 500, 0)
            self.assertEqual([l.id for l in after.items if l.id != self.unpriced.id], [l.id for l in before.items])

    def test_it_is_counted_as_a_sofa_and_in_no_price_band(self):
        sofas = find([{"k": "category", "value": "sofa"}])
        before = memory.search(self.listings, sofas, 500, 0).facets
        after = memory.search(self.everything, sofas, 500, 0).facets
        self.assertEqual(after.category[0].count, before.category[0].count + 1, "one more sofa matches")
        self.assertEqual(after.price_band, before.price_band, "and no band moves: the probe saw 0-10000 go from 0 to 1")
        self.assertEqual(sum(b.count for b in after.price_band), sum(has_price(l) for l in self.everything if l.category == "sofa"))


class ElasticQueryTests(SimpleTestCase):
    def test_both_price_clauses_require_a_known_price_in_the_same_range(self):
        filters = to_es_bool(find([{"k": "price_max", "cents": 40000}, {"k": "price_min", "cents": 0}]), ())["bool"]["filter"]
        self.assertEqual(filters, [{"range": {"price_cents": {"gte": MIN_KNOWN_PRICE_CENTS, "lte": 40000}}},
                                   {"range": {"price_cents": {"gte": MIN_KNOWN_PRICE_CENTS}}}])
        above = to_es_bool(find([{"k": "price_min", "cents": 25000}]), ())["bool"]["filter"]
        self.assertEqual(above, [{"range": {"price_cents": {"gte": 25000}}}], "a real lower bound is left alone")

    def test_the_first_price_band_starts_at_the_lowest_known_price_and_keeps_its_key(self):
        ranges = es_aggs([])["price_band"]["range"]["ranges"]
        self.assertEqual([r["key"] for r in ranges], [key for key, _, _ in PRICE_BANDS])
        self.assertEqual(ranges[0], {"key": "0-10000", "from": MIN_KNOWN_PRICE_CENTS, "to": 10000})
        self.assertEqual([r["from"] for r in ranges[1:]], [low for _, low, _ in PRICE_BANDS[1:]])

    def test_memory_bands_and_the_elasticsearch_ranges_describe_the_same_sets(self):
        # Walk every listing through the range definitions the way Elasticsearch would, and compare with memory.
        listings, unpriced = with_an_unpriced_sofa()
        everything = listings + [unpriced]
        ranges = es_aggs([])["price_band"]["range"]["ranges"]
        by_range = {r["key"]: sum(1 for l in everything if l.price_cents >= r["from"] and ("to" not in r or l.price_cents < r["to"])) for r in ranges}
        self.assertEqual(by_range, {b.key: b.count for b in memory_facets(everything, [], 0).price_band})


@unittest.skipUnless(os.getenv("ELASTIC_LIVE_TEST") == "1", "live Elasticsearch test; set ELASTIC_LIVE_TEST=1")
class LivePriceAgreementTests(SimpleTestCase):
    """Run this after ingesting listings with unknown prices: it is where the rule meets the real index.
    (Requires the index to agree with the files first: uv run python -m catalogue.index_check.)"""

    QUERIES = ([{"k": "price_max", "cents": 40000}], [{"k": "price_min", "cents": 0}], [{"k": "price_min", "cents": 25000}],
               [{"k": "category", "value": "sofa"}, {"k": "price_max", "cents": 40000}], [{"k": "category", "value": "sofa"}], [])

    def test_memory_and_the_live_index_agree_on_every_price_query_and_every_band(self):
        from catalogue import es
        from catalogue.feed import load_catalogue
        from catalogue.types import to_wire
        catalogue = load_catalogue()
        for raw in self.QUERIES:
            with self.subTest(query=raw):
                self.assertEqual(to_wire(es.search(find(raw), 24, 0)), to_wire(memory.search(catalogue, find(raw), 24, 0)))
