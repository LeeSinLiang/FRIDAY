"""Query text tokenising, shared by both search backends so they agree on what a token is. Pure."""

import re
from functools import lru_cache
from collections.abc import Callable, Sequence

_WORD = re.compile(r"\w+")


@lru_cache(maxsize=32768)
def title_words(title: str) -> frozenset[str]:
    """A title's tokens as a set. Cached: the catalogue's titles are matched on every text search."""
    return frozenset(tokenize(title))


def tokenize(text: str) -> list[str]:
    """Lowercased word tokens. Mirrors what Elasticsearch's standard analyzer does to a title."""
    return _WORD.findall(text.lower())


# Words that carry no information about WHICH item: grammar, and the vocabulary of placement,
# price and size that a shopper's sentence is full of but no listing is found by.
STOP_WORDS: frozenset[str] = frozenset("""
a an the and or of for to in on at by with from that this it its is are be i we my our me some something
any want need looking find get would like please put place goes go fit fits fitting keep leave dont don t
not no under over below above less more than least most about around within between each per
near next beside against along away clear blocking block front behind
wall walls window windows door doors room
feet foot ft inch inches cm mm m metre metres meter meters wide width gap
dollar dollars usd cheap cheaper budget price priced cost costs
""".split())


def content_words(text: str) -> list[str]:
    """The words of a sentence worth searching for, in order, without repeats."""
    words: list[str] = []
    for token in tokenize(text):
        if token not in STOP_WORDS and not token.isdigit() and token not in words:
            words.append(token)
    return words


def keep_matching(words: Sequence[str], has_results: Callable[[list[str]], bool]) -> list[str]:
    """Greedily keep each word only if the search still finds something with it added.

    Search needs every word to hit, so one word the catalogue cannot satisfy together with the
    others ("reading chair wall") would empty the results. Earlier words win, as the shopper
    said them first.
    """
    kept: list[str] = []
    for word in words:
        if has_results(kept + [word]):
            kept.append(word)
    return kept
