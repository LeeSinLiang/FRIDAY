"""Text -> Program. One structured-output model call, at most one retry, never raises.

The model never sees the search backend: it emits a Program and nothing else.
"""

import asyncio
import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

from agents import Agent, AgentOutputSchema, ModelSettings, Runner, set_default_openai_client, set_tracing_disabled
from agents.exceptions import AgentsException
from openai import APITimeoutError, AsyncOpenAI, OpenAIError
from openai.types.shared import Reasoning

from catalogue.dsl.prompt import build_instructions
from catalogue.dsl.schema import Program
from catalogue.text import content_words, keep_matching

logger = logging.getLogger(__name__)

# Cheapest model that holds the schema: gpt-4.1-nano scored 6-7 of 8 on the fixture and invented
# placement clauses; this tier scores 8 of 8. Latency is the same for both, it is network-bound.
DEFAULT_MODEL = "gpt-4.1-mini"
# Normal calls finish in 0.7-2.6 s, so 3 s clipped the legitimate tail. Compile is a submit action,
# not a keystroke, so waiting for a slow success beats a fast fallback.
REQUEST_TIMEOUT_S = 6
MAX_OUTPUT_TOKENS = 400
MAX_INPUT_CHARS = 300
MAX_ATTEMPTS = 2  # the first call plus one retry, whether it was invalid or timed out. Never more.

# Chips and fixtures should not depend on the order the model happened to list things in.
FIND_ORDER = ("text", "category", "price_max", "price_min", "colour", "material", "fits_w_max")

ModelCall = Callable[[str, str], Program]
HasResults = Callable[[list[str]], bool]


class InvalidProgram(ValueError):
    """The model answered, but the Program is not usable. The only failure that earns a retry."""


@dataclass(frozen=True)
class CompileResult:
    program: Program
    source: str  # model | model-retry | fallback | empty
    ms: int


def model_name() -> str:
    return os.getenv("OPENAI_MODEL") or DEFAULT_MODEL


def model_settings(model: str) -> ModelSettings:
    # Reasoning-family models reject temperature and think by default; extraction needs no thinking.
    if model.startswith(("gpt-5", "o")):
        return ModelSettings(reasoning=Reasoning(effort="none"), max_tokens=MAX_OUTPUT_TOKENS)
    return ModelSettings(temperature=0, max_tokens=MAX_OUTPUT_TOKENS)


def fallback_program(text: str, has_results: HasResults | None = None) -> Program:
    """A text search of the sentence's content words, for when the model is unavailable.

    The whole sentence would match nothing, since search needs every word to hit. With a
    has_results check, "a reading chair by the window under $400" degrades to "reading chair"
    and still finds reading chairs. A fallback with no results is a failure, not a degradation.
    """
    words = content_words(text)
    if has_results is not None:
        words = keep_matching(words, has_results)
    find = [{"k": "text", "q": " ".join(words)}] if words else []
    return Program.model_validate({"find": find, "place": []})


@lru_cache(maxsize=1)
def _event_loop() -> asyncio.AbstractEventLoop:
    # One long-lived loop so the HTTP connection to the model stays warm between requests.
    # A loop per call would redo the TLS handshake every time, which alone can exceed the latency budget.
    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, name="compile-loop", daemon=True).start()
    set_tracing_disabled(True)
    set_default_openai_client(AsyncOpenAI(timeout=REQUEST_TIMEOUT_S, max_retries=0), use_for_tracing=False)
    return loop


def call_model(text: str, instructions: str) -> Program:
    """One model turn with Program as the structured output type.

    Raises:
        InvalidProgram: the output did not validate as a Program.
        OpenAIError, AgentsException, TimeoutError: the call itself failed.
    """
    agent = Agent(
        name="compile",
        instructions=instructions,
        model=model_name(),
        model_settings=model_settings(model_name()),
        output_type=AgentOutputSchema(Program, strict_json_schema=True),
    )
    future = asyncio.run_coroutine_threadsafe(Runner.run(agent, text, max_turns=1), _event_loop())
    try:
        return future.result(timeout=REQUEST_TIMEOUT_S + 1).final_output
    except TimeoutError:
        future.cancel()  # otherwise the abandoned call keeps running on the shared loop
        raise
    except AgentsException as exc:
        if type(exc).__name__ == "ModelBehaviorError":
            raise InvalidProgram("output did not match the Program schema") from exc
        raise


def normalise(program: Program) -> Program:
    """Canonical form: find clauses in a fixed order, lowercase hexes and materials, qty only above one."""
    data = program.model_dump()
    data["find"] = sorted(data["find"], key=lambda clause: FIND_ORDER.index(clause["k"]))
    for clause in data["find"]:
        for field in ("hex", "value"):
            if field in clause:
                clause[field] = clause[field].lower()
    if data["qty"] is not None and data["qty"] <= 1:
        data["qty"] = None
    return Program.model_validate(data)


def check_refs(program: Program, refs: dict) -> None:
    """Reject ids the room does not have. The schema cannot know the room, so this is checked here.

    Raises:
        InvalidProgram: a place clause points at an unknown id.
    """
    known = {kind: {entry["id"] for entry in refs.get(group, [])}
             for kind, group in (("wall", "walls"), ("window", "windows"), ("door", "doors"), ("instance", "instances"))}
    for clause in program.place:
        ref_id = getattr(clause.ref, "id", None)
        if ref_id is not None and ref_id not in known[clause.ref.kind]:
            raise InvalidProgram(f"unknown {clause.ref.kind} id")


def _attempt(text: str, refs: dict, instructions: str, call: ModelCall) -> Program | None:
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            program = normalise(call(text, instructions))
            check_refs(program, refs)
            return program
        except InvalidProgram as exc:
            logger.warning("compile attempt %s invalid: %s", attempt, exc)
        except (APITimeoutError, TimeoutError) as exc:
            # A hang is per-request; the retry usually lands in about a second.
            logger.warning("compile attempt %s timed out: %s", attempt, type(exc).__name__)
        except (OpenAIError, AgentsException) as exc:
            # Auth, quota or a refused request will fail the same way again.
            logger.warning("compile call failed: %s", type(exc).__name__)
            return None
    return None


def compile_text(text: str, refs: dict, has_results: HasResults | None = None,
                 call: ModelCall = call_model) -> CompileResult:
    """Compile a shopper's sentence. Always returns a usable Program; on any failure, a content-word search.

    Args:
        text: what the shopper typed or said.
        refs: the room's referenceable ids, from room_refs().
        has_results: whether a text search for these words finds anything; keeps the fallback useful.
        call: the model call, injectable so tests never touch the network.
    """
    started = time.perf_counter()
    text = text.strip()[:MAX_INPUT_CHARS]
    if not text:
        return CompileResult(Program(find=[], place=[]), "empty", 0)
    calls = []

    def counted(prompt_text: str, instructions: str) -> Program:
        calls.append(1)
        return call(prompt_text, instructions)

    program = _attempt(text, refs, build_instructions(refs), counted)
    ms = round((time.perf_counter() - started) * 1000)
    if program is None:
        return CompileResult(fallback_program(text, has_results), "fallback", ms)
    return CompileResult(program, "model" if len(calls) == 1 else "model-retry", ms)
