"""compile() and render(). No network: the model call is replaced with recorded outputs.

Set COMPILE_LIVE_TEST=1 to also run the fixture against the real model (needs OPENAI_API_KEY).
"""

import json
import os
import unittest
from pathlib import Path
from unittest import mock

from django.core.cache import cache
from django.db import OperationalError
from django.test import SimpleTestCase, override_settings
from openai import APITimeoutError, AuthenticationError
from rest_framework.test import APIClient

from catalogue import memory
from catalogue.dsl import compile as compile_module
from catalogue.dsl.compile import InvalidProgram, compile_text, fallback_program
from catalogue.dsl.prompt import build_instructions
from catalogue.dsl.render import render
from catalogue.dsl.schema import Program
from catalogue.dsl.units import format_cents, format_mm
from catalogue.feed import load_catalogue
from catalogue.mock.room import MOCK_ROOM, room_refs
from catalogue.text import content_words, keep_matching
from catalogue.types import to_wire
from catalogue.views import CompileThrottle, text_search_has_results

FIXTURE = Path(__file__).resolve().parent / "dsl" / "fixtures" / "compile_cases.json"
REFS = room_refs(MOCK_ROOM)

with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)["cases"]


def replay(outputs: list):
    """A model call that returns the given outputs in turn; an exception instance is raised instead."""
    remaining = list(outputs)

    def call(text: str, instructions: str) -> Program:
        output = remaining.pop(0)
        if isinstance(output, Exception):
            raise output
        return Program.model_validate(output)

    call.remaining = remaining
    return call


def wire(program_dict: dict) -> dict:
    return to_wire(Program.model_validate(program_dict))


class FixtureTests(SimpleTestCase):
    def test_there_are_nine_recorded_cases(self):
        self.assertEqual(len(CASES), 9)
        self.assertTrue(all("recorded" in case for case in CASES))

    def test_recorded_model_outputs_compile_to_the_expected_programs(self):
        for case in CASES:
            result = compile_text(case["text"], REFS, call=replay([case["recorded"]]))
            self.assertEqual(result.source, "model", msg=case["text"])
            self.assertEqual(to_wire(result.program), wire(case["expected"]), msg=case["text"])

    def test_expected_programs_render_to_the_expected_chips(self):
        for case in CASES:
            self.assertEqual(render(Program.model_validate(case["expected"]), REFS), case["chips"], msg=case["text"])

    def test_the_fixture_covers_every_clause_kind_the_demo_needs(self):
        kinds = {clause["k"] for case in CASES for group in ("find", "place") for clause in case["expected"][group]}
        self.assertGreaterEqual(kinds, {"text", "category", "price_max", "price_min", "colour", "material",
                                        "fits_w_max", "near", "against", "distance_min", "clear", "not_blocking"})


class FailureHandlingTests(SimpleTestCase):
    TEXT = "a reading chair by the window"
    GOOD = {"find": [{"k": "category", "value": "armchair"}], "place": [], "qty": None}
    BAD_REF = {"find": [], "place": [{"k": "near", "ref": {"kind": "window", "id": "w9"}, "mm": None}], "qty": None}

    def test_one_retry_after_an_invalid_program(self):
        call = replay([InvalidProgram("schema"), self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual((result.source, call.remaining), ("model-retry", []))
        self.assertEqual(to_wire(result.program), wire(self.GOOD))

    def test_two_invalid_programs_degrade_to_text_search_without_a_third_call(self):
        call = replay([InvalidProgram("schema"), InvalidProgram("schema"), self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual(result.source, "fallback")
        self.assertEqual(to_wire(result.program), {"find": [{"k": "text", "q": "reading chair"}], "place": []})
        self.assertEqual(len(call.remaining), 1)

    def test_an_id_the_room_does_not_have_counts_as_invalid(self):
        result = compile_text(self.TEXT, REFS, call=replay([self.BAD_REF, self.BAD_REF]))
        self.assertEqual(result.source, "fallback")

    def test_a_timeout_gets_the_one_retry(self):
        call = replay([APITimeoutError(request=mock.Mock()), self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual((result.source, call.remaining), ("model-retry", []))

    def test_two_timeouts_degrade_without_a_third_call(self):
        call = replay([APITimeoutError(request=mock.Mock()), TimeoutError(), self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual((result.source, len(call.remaining)), ("fallback", 1))

    def test_a_timeout_and_an_invalid_program_share_the_single_retry(self):
        call = replay([TimeoutError(), InvalidProgram("schema"), self.GOOD])
        self.assertEqual(compile_text(self.TEXT, REFS, call=call).source, "fallback")
        self.assertEqual(len(call.remaining), 1)

    def test_an_error_that_would_repeat_is_not_retried(self):
        error = AuthenticationError("bad key", response=mock.Mock(status_code=401), body=None)
        call = replay([error, self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual((result.source, len(call.remaining)), ("fallback", 1))

    def test_empty_input_makes_no_call(self):
        result = compile_text("   ", REFS, call=replay([]))
        self.assertEqual((result.source, to_wire(result.program)), ("empty", {"find": [], "place": []}))

    def test_long_input_is_truncated_before_the_model_sees_it(self):
        seen = []
        compile_text("x" * 1000, REFS, call=lambda text, _: seen.append(text) or fallback_program(text))
        self.assertEqual(len(seen[0]), compile_module.MAX_INPUT_CHARS)


class FallbackSearchTests(SimpleTestCase):
    """A fallback that finds nothing is a failure, not a degradation."""

    HERO = "a reading chair by the window, under $400, 5 feet from any wall"

    def test_stop_words_numbers_and_repeats_are_dropped(self):
        self.assertEqual(content_words(self.HERO), ["reading", "chair"])
        self.assertEqual(content_words("cosy velvet corner sofa"), ["cosy", "velvet", "corner", "sofa"])
        # Sub-types that look like room words are product words and must survive.
        self.assertEqual(content_words("a floor lamp and a side table"), ["floor", "lamp", "side", "table"])
        self.assertEqual(content_words("a chair, the CHAIR, 2 chairs"), ["chair", "chairs"])

    def test_a_word_survives_only_if_results_remain_with_it(self):
        # "wall" and "lamp" are both real catalogue words, but no listing is a wall lamp.
        self.assertTrue(text_search_has_results(["wall"]) and text_search_has_results(["lamp"]))
        self.assertEqual(keep_matching(["steel", "lamp", "wall", "xyzzy"], text_search_has_results), ["steel", "lamp"])

    def test_the_hero_sentence_still_finds_reading_chairs_when_the_model_is_down(self):
        program = fallback_program(self.HERO, text_search_has_results)
        self.assertEqual(to_wire(program), {"find": [{"k": "text", "q": "reading chair"}], "place": []})
        result = memory.search(load_catalogue(), program.find, limit=24, offset=0)
        self.assertGreater(result.total, 0)
        self.assertTrue(all("reading chair" in item.title for item in result.items))

    def test_the_whole_sentence_would_have_found_nothing(self):
        whole = Program.model_validate({"find": [{"k": "text", "q": self.HERO}], "place": []})
        self.assertEqual(memory.search(load_catalogue(), whole.find, limit=24, offset=0).total, 0)

    def test_every_fixture_sentence_degrades_to_a_search_with_results(self):
        for case in CASES:
            program = fallback_program(case["text"], text_search_has_results)
            total = memory.search(load_catalogue(), program.find, limit=1, offset=0).total
            self.assertGreater(total, 0, msg=f"{case['text']} -> {to_wire(program)}")

    def test_nothing_searchable_means_browse_everything_not_an_invalid_clause(self):
        program = fallback_program("something for the balcony", text_search_has_results)
        self.assertEqual(to_wire(program), {"find": [], "place": []})


class NormaliseTests(SimpleTestCase):
    def test_find_order_case_and_single_quantity(self):
        raw = {"find": [{"k": "material", "value": "Oak"}, {"k": "colour", "hex": "#3F7D4E"},
                        {"k": "category", "value": "desk"}], "place": [], "qty": 1}
        result = compile_text("oak desk", REFS, call=replay([raw]))
        self.assertEqual(to_wire(result.program), {"find": [
            {"k": "category", "value": "desk"}, {"k": "colour", "hex": "#3f7d4e"}, {"k": "material", "value": "oak"},
        ], "place": []})


def place_of(*clauses: dict) -> list[dict]:
    raw = {"find": [], "place": list(clauses), "qty": None}
    return to_wire(compile_text("x", REFS, call=replay([raw])).program)["place"]


def dist(ref: dict, mm: int, k: str = "distance_min") -> dict:
    return {"k": k, "ref": ref, "mm": mm}


def wall(wall_id: str) -> dict:
    return {"kind": "wall", "id": wall_id}


ANY = {"kind": "any_wall"}


class WallRepairTests(SimpleTestCase):
    """any_wall means every wall for distance_min and clear, and any one wall for near, against, on."""

    def test_an_exception_beside_any_wall_is_not_silently_erased(self):
        # The original bug: any_wall(914) AND w-w(610) means 914 everywhere.
        self.assertEqual(place_of(dist(wall("w-w"), 610), dist(ANY, 914)), [
            dist(wall("w-n"), 914), dist(wall("w-e"), 914), dist(wall("w-s"), 914), dist(wall("w-w"), 610)])

    def test_a_stricter_wall_beside_any_wall_is_already_correct(self):
        self.assertEqual(place_of(dist(ANY, 500), dist(wall("w-n"), 900)), [dist(ANY, 500), dist(wall("w-n"), 900)])

    def test_the_same_value_on_every_wall_collapses_to_any_wall(self):
        walls = [dist(wall(w), 1524) for w in ("w-s", "w-n", "w-w", "w-e")]
        self.assertEqual(place_of({"k": "near", "ref": {"kind": "window", "id": "w1"}, "mm": None}, *walls),
                         [{"k": "near", "ref": {"kind": "window", "id": "w1"}}, dist(ANY, 1524)])

    def test_different_values_or_a_missing_wall_stay_per_wall_in_room_order(self):
        self.assertEqual(place_of(dist(wall("w-w"), 610), dist(wall("w-n"), 914), dist(wall("w-e"), 914)),
                         [dist(wall("w-n"), 914), dist(wall("w-e"), 914), dist(wall("w-w"), 610)])

    def test_clear_gets_the_same_treatment(self):
        self.assertEqual(place_of(dist(ANY, 1000, "clear"), dist(wall("w-n"), 300, "clear")), [
            dist(wall("w-n"), 300, "clear"), dist(wall("w-e"), 1000, "clear"),
            dist(wall("w-s"), 1000, "clear"), dist(wall("w-w"), 1000, "clear")])

    def test_several_walls_for_a_one_wall_kind_become_any_wall(self):
        against = [{"k": "against", "ref": wall(w)} for w in ("w-n", "w-e", "w-s")]
        self.assertEqual(place_of(*against), [{"k": "against", "ref": ANY}])
        self.assertEqual(place_of({"k": "against", "ref": wall("w-e")}), [{"k": "against", "ref": wall("w-e")}])


class PromptTests(SimpleTestCase):
    def test_the_model_is_told_about_the_room_and_nothing_about_the_search_engine(self):
        prompt = build_instructions(REFS)
        for ref_id in ("w-n", "w1", "d1", "sofa-1", "lamp-1"):
            self.assertIn(ref_id, prompt)
        for forbidden in ("elastic", "query dsl", "bool", "_search", "index"):
            self.assertNotIn(forbidden, prompt.lower())


class RenderTests(SimpleTestCase):
    def test_lengths_read_the_way_they_were_said(self):
        self.assertEqual([format_mm(mm) for mm in (1524, 762, 900, 1500, 1185)],
                         ["5 ft", "30 in", "90 cm", "1.5 m", "1185 mm"])

    def test_money(self):
        self.assertEqual([format_cents(c) for c in (40000, 129900, 4999)], ["$400", "$1,299", "$49.99"])

    def test_chips_never_contain_clause_syntax(self):
        for case in CASES:
            for chip in case["chips"]:
                for raw in ("{", "}", "price_max", "distance_min", "any_wall", "w-n", "#"):
                    self.assertNotIn(raw, chip)

    def test_refs_without_labels_still_read_naturally(self):
        program = Program.model_validate({"find": [], "place": [
            {"k": "against", "ref": {"kind": "wall", "id": "w-n"}}, {"k": "near", "ref": {"kind": "door"}, "mm": 610}]})
        self.assertEqual(render(program), ["against the wall", "within 2 ft of the door"])


# The compile throttle counts requests in the cache. These tests touch no database, so they pin an
# in-memory cache rather than inherit whatever the project configures: with a database-backed cache
# (the accounts work uses one) a SimpleTestCase would be refused the query. Runtime keeps the
# project's cache, so rate limits still persist where the project wants them to.
@override_settings(CACHES={"default": {
    "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    "LOCATION": "catalogue-compile-endpoint-tests",
}})
class CompileEndpointTests(SimpleTestCase):
    def setUp(self):
        cache.clear()  # throttle counters live in the cache
        self.addCleanup(cache.clear)

    def post(self, body):
        return APIClient().post("/api/compile", body, format="json")

    def test_returns_program_chips_source_and_timing(self):
        case = CASES[0]
        with mock.patch("catalogue.dsl.compile.call_model", replay([case["recorded"]])), \
                mock.patch("catalogue.views.compile_text",
                           lambda text, refs, has_results: compile_text(text, refs, has_results,
                                                                        call=compile_module.call_model)):
            response = self.post({"text": case["text"]})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"program", "chips", "source", "ms"})
        self.assertEqual((body["program"], body["chips"], body["source"]), (wire(case["expected"]), case["chips"], "model"))

    def test_model_failure_is_a_200_with_a_text_search(self):
        failing = replay([InvalidProgram("x")] * 2)
        with mock.patch("catalogue.views.compile_text",
                        lambda text, refs, has_results: compile_text(text, refs, has_results, call=failing)):
            response = self.post({"text": "a green oak desk by the door please"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["program"], {"find": [{"k": "text", "q": "oak desk"}], "place": []})
        self.assertEqual((response.json()["source"], response.json()["chips"]), ("fallback", ["\u201coak desk\u201d"]))

    def test_the_paid_endpoint_is_throttled_per_client(self):
        ok = mock.Mock(return_value=compile_module.CompileResult(Program(find=[], place=[]), "model", 1))
        with mock.patch.object(CompileThrottle, "rate", "2/min"), mock.patch("catalogue.views.compile_text", ok):
            statuses = [self.post({"text": "a chair"}).status_code for _ in range(3)]
        self.assertEqual(statuses, [200, 200, 429])
        self.assertEqual(ok.call_count, 2)

    def test_a_real_cache_backend_that_raises_does_not_take_compile_down(self):
        # The test above fakes the throttle. This one breaks the actual cache underneath it, which is
        # what a missing cache table or a dead cache server looks like to DRF.
        ok = mock.Mock(return_value=compile_module.CompileResult(Program(find=[], place=[]), "model", 1))
        with mock.patch("django.core.cache.backends.locmem.LocMemCache.get", side_effect=OperationalError("no such table: friday_cache")), \
                mock.patch("catalogue.views.compile_text", ok), self.assertLogs("catalogue.views", level="WARNING") as logs:
            self.assertEqual(self.post({"text": "a chair"}).status_code, 200)
        self.assertEqual(len(logs.output), 1)
        self.assertEqual(ok.call_count, 1)

    def test_an_unreachable_cache_does_not_take_compile_down(self):
        ok = mock.Mock(return_value=compile_module.CompileResult(Program(find=[], place=[]), "model", 1))
        for failure in (OperationalError("no such table: friday_cache"), ConnectionRefusedError("cache server down")):
            with mock.patch("rest_framework.throttling.SimpleRateThrottle.allow_request", side_effect=failure), \
                    mock.patch("catalogue.views.compile_text", ok), \
                    self.assertLogs("catalogue.views", level="WARNING") as logs:
                self.assertEqual(self.post({"text": "a chair"}).status_code, 200, type(failure).__name__)
            # Once per request, naming the error type and nothing else: no credentials, no SQL.
            self.assertEqual(logs.output, [f"WARNING:catalogue.views:compile throttle unavailable, allowing the request: {type(failure).__name__}"])
        self.assertEqual(ok.call_count, 2)

    def test_search_is_not_throttled(self):
        with mock.patch.object(CompileThrottle, "rate", "1/min"):
            statuses = [APIClient().get("/api/search?limit=1").status_code for _ in range(3)]
        self.assertEqual(statuses, [200, 200, 200])

    def test_bad_input_is_rejected_before_any_model_call(self):
        with mock.patch("catalogue.views.compile_text", side_effect=AssertionError("must not be called")):
            self.assertEqual(self.post({"text": 5}).status_code, 400)
            self.assertEqual(self.post({"text": "x" * 301}).status_code, 400)
            self.assertEqual(self.post({}).status_code, 400)


@unittest.skipUnless(os.getenv("COMPILE_LIVE_TEST") == "1", "live model test; set COMPILE_LIVE_TEST=1")
class LiveModelTests(SimpleTestCase):
    def test_fixture_against_the_real_model(self):
        # A hung request legitimately degrades to a text search; that is availability, not accuracy.
        # Every Program the model did return must be exactly right, and hangs must stay rare.
        fallbacks = 0
        for case in CASES:
            result = compile_text(case["text"], REFS)
            if result.source == "fallback":
                fallbacks += 1
                continue
            self.assertEqual(to_wire(result.program), wire(case["expected"]), msg=case["text"])
        self.assertLessEqual(fallbacks, 2)
