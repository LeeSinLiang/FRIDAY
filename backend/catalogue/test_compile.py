"""compile() and render(). No network: the model call is replaced with recorded outputs.

Set COMPILE_LIVE_TEST=1 to also run the fixture against the real model (needs OPENAI_API_KEY).
"""

import json
import os
import unittest
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase
from openai import APITimeoutError
from rest_framework.test import APIClient

from catalogue.dsl import compile as compile_module
from catalogue.dsl.compile import InvalidProgram, compile_text, fallback_program
from catalogue.dsl.prompt import build_instructions
from catalogue.dsl.render import render
from catalogue.dsl.schema import Program
from catalogue.dsl.units import format_cents, format_mm
from catalogue.mock.room import MOCK_ROOM, room_refs
from catalogue.types import to_wire

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
    def test_there_are_eight_recorded_cases(self):
        self.assertEqual(len(CASES), 8)
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
        self.assertEqual(to_wire(result.program), {"find": [{"k": "text", "q": self.TEXT}], "place": []})
        self.assertEqual(len(call.remaining), 1)

    def test_an_id_the_room_does_not_have_counts_as_invalid(self):
        result = compile_text(self.TEXT, REFS, call=replay([self.BAD_REF, self.BAD_REF]))
        self.assertEqual(result.source, "fallback")

    def test_a_failed_call_is_not_retried(self):
        call = replay([APITimeoutError(request=mock.Mock()), self.GOOD])
        result = compile_text(self.TEXT, REFS, call=call)
        self.assertEqual((result.source, len(call.remaining)), ("fallback", 1))

    def test_empty_input_makes_no_call(self):
        result = compile_text("   ", REFS, call=replay([]))
        self.assertEqual((result.source, to_wire(result.program)), ("empty", {"find": [], "place": []}))

    def test_long_input_is_truncated_before_the_model_sees_it(self):
        seen = []
        compile_text("x" * 1000, REFS, call=lambda text, _: seen.append(text) or fallback_program(text))
        self.assertEqual(len(seen[0]), compile_module.MAX_INPUT_CHARS)


class NormaliseTests(SimpleTestCase):
    def test_find_order_case_and_single_quantity(self):
        raw = {"find": [{"k": "material", "value": "Oak"}, {"k": "colour", "hex": "#3F7D4E"},
                        {"k": "category", "value": "desk"}], "place": [], "qty": 1}
        result = compile_text("oak desk", REFS, call=replay([raw]))
        self.assertEqual(to_wire(result.program), {"find": [
            {"k": "category", "value": "desk"}, {"k": "colour", "hex": "#3f7d4e"}, {"k": "material", "value": "oak"},
        ], "place": []})


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


class CompileEndpointTests(SimpleTestCase):
    def post(self, body):
        return APIClient().post("/api/compile", body, format="json")

    def test_returns_program_chips_source_and_timing(self):
        case = CASES[0]
        with mock.patch("catalogue.dsl.compile.call_model", replay([case["recorded"]])), \
                mock.patch("catalogue.views.compile_text",
                           lambda text, refs: compile_text(text, refs, call=compile_module.call_model)):
            response = self.post({"text": case["text"]})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"program", "chips", "source", "ms"})
        self.assertEqual((body["program"], body["chips"], body["source"]), (wire(case["expected"]), case["chips"], "model"))

    def test_model_failure_is_a_200_with_a_text_search(self):
        with mock.patch("catalogue.views.compile_text",
                        lambda text, refs: compile_text(text, refs, call=replay([InvalidProgram("x")] * 2))):
            response = self.post({"text": "anything at all"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["program"], {"find": [{"k": "text", "q": "anything at all"}], "place": []})
        self.assertEqual(response.json()["source"], "fallback")

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
