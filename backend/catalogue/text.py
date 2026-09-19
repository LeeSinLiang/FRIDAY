"""Query text tokenising, shared by both search backends so they agree on what a token is. Pure."""

import re

_WORD = re.compile(r"\w+")


def tokenize(text: str) -> list[str]:
    """Lowercased word tokens. Mirrors what Elasticsearch's standard analyzer does to a title."""
    return _WORD.findall(text.lower())
