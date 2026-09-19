"""Elasticsearch query building and backend switching. No network: the client is never constructed."""

import os
from unittest import mock

from django.test import SimpleTestCase
from elastic_transport import ConnectionError as EsConnectionError
from pydantic import TypeAdapter
from rest_framework.test import APIClient

from catalogue import es, memory
from catalogue.dsl.schema import FindClause
from catalogue.feed import load_listings
from catalogue.ingest import to_actions
from catalogue.to_es_query import to_es_bool, to_es_query
from catalogue.types import to_wire

PALETTE = ["#2f5d50", "#3f7d4e", "#ffffff", "#1c1c1c"]
_FIND = TypeAdapter(list[FindClause])


def bool_for(*clauses: dict) -> dict:
    return to_es_bool(_FIND.validate_python(list(clauses)), PALETTE)["bool"]


class FindClauseQueryTests(SimpleTestCase):
    def test_text_is_the_only_clause_in_must_one_query_per_token(self):
        query = bool_for({"k": "text", "q": "Wing chair"})
        self.assertEqual(query["filter"], [])
        self.assertEqual(len(query["must"]), 2)
        self.assertEqual(query["must"][0]["bool"]["should"], [
            {"match": {"title": "wing"}},
            {"term": {"category": "wing"}},
            {"wildcard": {"materials": {"value": "*wing*", "case_insensitive": True}}},
        ])

    def test_category(self):
        self.assertEqual(bool_for({"k": "category", "value": "armchair"})["filter"],
                         [{"term": {"category": "armchair"}}])

    def test_price_max(self):
        self.assertEqual(bool_for({"k": "price_max", "cents": 40000})["filter"],
                         [{"range": {"price_cents": {"lte": 40000}}}])

    def test_price_min(self):
        self.assertEqual(bool_for({"k": "price_min", "cents": 10000})["filter"],
                         [{"range": {"price_cents": {"gte": 10000}}}])

    def test_colour_expands_to_nearby_palette_hexes(self):
        self.assertEqual(bool_for({"k": "colour", "hex": "#2a5a4c"})["filter"],
                         [{"terms": {"colour_hex": ["#2f5d50", "#3f7d4e"]}}])

    def test_colour_with_no_nearby_hex_matches_nothing(self):
        self.assertEqual(bool_for({"k": "colour", "hex": "#ff00ff"})["filter"], [{"terms": {"colour_hex": []}}])

    def test_material_is_case_insensitive_wildcard_with_specials_escaped(self):
        self.assertEqual(bool_for({"k": "material", "value": "Oak*"})["filter"], [
            {"wildcard": {"materials": {"value": r"*Oak\**", "case_insensitive": True}}},
        ])

    def test_fits_w_max(self):
        self.assertEqual(bool_for({"k": "fits_w_max", "mm": 900})["filter"],
                         [{"range": {"dims_mm.w": {"lte": 900}}}])

    def test_structured_clauses_never_score(self):
        query = bool_for({"k": "category", "value": "sofa"}, {"k": "price_max", "cents": 1}, {"k": "text", "q": "x"})
        self.assertEqual((len(query["must"]), len(query["filter"])), (1, 2))


def colour_probes() -> list[str]:
    """Every colour in the catalogue, plus a 6x6x6 sweep of the RGB cube."""
    steps = (0, 51, 102, 153, 204, 255)
    cube = [f"#{r:02x}{g:02x}{b:02x}" for r in steps for g in steps for b in steps]
    return sorted({hex_ for listing in load_listings() for hex_ in listing.colour_hex}) + cube


class ColourBackendAgreementTests(SimpleTestCase):
    """Memory matches colours by RGB distance per listing; Elasticsearch by a terms filter over the
    palette. They agree exactly as long as the palette holds every indexed colour. Proven here by
    evaluating the generated terms filter against the same listings, for 250+ probe colours."""

    def setUp(self):
        self.listings = load_listings()
        self.palette = sorted({hex_ for listing in self.listings for hex_ in listing.colour_hex})

    def ids_by_terms_filter(self, probe: str) -> list[str]:
        clause = _FIND.validate_python([{"k": "colour", "hex": probe}])
        (terms_filter,) = to_es_bool(clause, self.palette)["bool"]["filter"]
        wanted = set(terms_filter["terms"]["colour_hex"])
        return sorted(l.id for l in self.listings if wanted & set(l.colour_hex))

    def test_every_probe_colour_selects_the_same_listings(self):
        matched_something = 0
        for probe in colour_probes():
            clause = _FIND.validate_python([{"k": "colour", "hex": probe}])
            from_memory = [l.id for l in memory.search(self.listings, clause, limit=100, offset=0).items]
            self.assertEqual(from_memory, self.ids_by_terms_filter(probe), msg=probe)
            matched_something += bool(from_memory)
        self.assertGreater(matched_something, 40)

    def test_an_incomplete_palette_would_disagree(self):
        # Guards the assumption above: the palette must come from the whole index.
        clause = _FIND.validate_python([{"k": "colour", "hex": "#2f5d50"}])
        self.assertEqual(to_es_bool(clause, ["#ffffff"])["bool"]["filter"], [{"terms": {"colour_hex": []}}])
        self.assertTrue(memory.search(self.listings, clause, limit=100, offset=0).items)

    def test_colour_search_reads_the_palette_from_the_index(self):
        es._palette.cache_clear()
        self.addCleanup(es._palette.cache_clear)
        client = mock.Mock()
        client.search.side_effect = [
            {"aggregations": {"colours": {"buckets": [{"key": "#2f5d50"}, {"key": "#ffffff"}]}}},
            {"hits": {"total": {"value": 0}, "hits": []}},
        ]
        with mock.patch.object(es, "get_client", return_value=client):
            es.search(_FIND.validate_python([{"k": "colour", "hex": "#2a5a4c"}]), limit=24, offset=0)
        palette_call, search_call = client.search.call_args_list
        self.assertEqual(palette_call.kwargs["aggs"]["colours"]["terms"]["field"], "colour_hex")
        self.assertEqual(search_call.kwargs["query"]["bool"]["filter"], [{"terms": {"colour_hex": ["#2f5d50"]}}])


class QueryBodyTests(SimpleTestCase):
    def test_paging_total_and_stable_sort(self):
        body = to_es_query([], PALETTE, limit=24, offset=48)
        self.assertEqual((body["from"], body["size"], body["track_total_hits"]), (48, 24, True))
        self.assertEqual(body["sort"], [{"_score": "desc"}, {"id": "asc"}])
        self.assertEqual(body["query"], {"bool": {"must": [], "filter": []}})


class IngestTests(SimpleTestCase):
    def test_actions_use_listing_id_and_only_mapped_fields(self):
        actions = list(to_actions(load_listings(), "listings"))
        self.assertEqual(len(actions), 40)
        mapped = {"id", "source", "title", "category", "price_cents", "dims_mm",
                  "colour_hex", "materials", "model_url", "thumb_url"}
        for action in actions:
            self.assertEqual(action["_id"], action["_source"]["id"])
            self.assertEqual(set(action["_source"]), mapped)


def fake_hits(listings) -> dict:
    return {"hits": {"total": {"value": len(listings)}, "hits": [{"_source": to_wire(l)} for l in listings]}}


class BackendSwitchTests(SimpleTestCase):
    URL = "/api/search?category=armchair&fits_w_mm=900"

    def setUp(self):
        es.get_client.cache_clear()
        self.addCleanup(es.get_client.cache_clear)

    def test_memory_is_the_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SEARCH_BACKEND", None)
            response = APIClient().get(self.URL)
        self.assertEqual(response["X-Search-Backend"], "memory")

    def test_elastic_returns_the_same_shape_as_memory(self):
        memory_body = APIClient().get(self.URL).json()
        armchairs = sorted((l for l in load_listings() if l.category == "armchair" and l.dims_mm.w <= 900),
                           key=lambda l: l.id)
        client = mock.Mock()
        client.search.return_value = fake_hits(armchairs)
        with mock.patch.dict(os.environ, {"SEARCH_BACKEND": "elastic"}), \
                mock.patch.object(es, "get_client", return_value=client):
            response = APIClient().get(self.URL)
        self.assertEqual(response["X-Search-Backend"], "elastic")
        self.assertEqual(response.json(), memory_body)
        sent = client.search.call_args.kwargs
        self.assertEqual((sent["index"], sent["from_"], sent["size"]), ("listings", 0, 24))
        self.assertNotIn("from", sent)

    def test_unreachable_cluster_falls_back_to_memory(self):
        client = mock.Mock()
        client.search.side_effect = EsConnectionError("down")
        with mock.patch.dict(os.environ, {"SEARCH_BACKEND": "elastic"}), \
                mock.patch.object(es, "get_client", return_value=client):
            response = APIClient().get(self.URL)
        self.assertEqual((response.status_code, response["X-Search-Backend"]), (200, "memory-fallback"))
        self.assertEqual(response.json()["total"], 4)

    def test_missing_credentials_fall_back_to_memory(self):
        env = {k: v for k, v in os.environ.items() if k not in ("ELASTIC_URL", "ELASTIC_API_KEY")}
        with mock.patch.dict(os.environ, {**env, "SEARCH_BACKEND": "elastic"}, clear=True):
            response = APIClient().get(self.URL)
        self.assertEqual(response["X-Search-Backend"], "memory-fallback")
