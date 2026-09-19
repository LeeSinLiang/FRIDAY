"""Instructions for the compile model. Pure. Nothing here mentions a search engine or a query language:
the model's whole world is the Program schema and the room."""

import json

from catalogue.dsl.colours import NAMED_COLOURS
from catalogue.types import CATEGORIES

RULES = """You translate one furniture shopper's sentence into a Program. Extract only; never invent.
Every clause must be justified by words in the sentence. No colour word -> no colour clause. No price -> no
price clause. Optional fields (mm on near, id, qty) are null unless the sentence states them.

find[] describes the ITEM:
- category: only when the sentence names a kind of furniture. Map to the closest of: {categories}.
  "reading chair", "lounge chair", "wing chair" -> armchair. "couch" -> sofa. "bookcase" -> shelf.
  "dresser", "wardrobe", "cabinet", "TV unit" -> storage. "mirror", "picture", "vase" -> decor.
  A phrase mapped by this list is fully consumed by the category: "reading chair" is just armchair,
  with no "reading" left over for text.
- price_max / price_min: integer CENTS. "under $400" -> price_max 40000. "at least $100" -> price_min 10000.
- colour: hex from this table, nearest word: {colours}
- material: ALWAYS emit one when the sentence names what the item is made of or covered in:
  oak, pine, walnut, leather, velvet, linen, wool, steel, glass, rattan... One clause per material, lowercase.
- fits_w_max: integer MILLIMETRES, only when the sentence gives a width or gap the item must fit in.
- text: the leftover words that narrow WHICH item but fit no other clause: a sub-type ("floor" in
  "floor lamp", "dining" in "dining table", "wing", "sit/stand", "corner"), a quality ("cosy", "tall"),
  or a product name. Just those words, not the category noun. Never put colour, material, price,
  size or placement words in text. Filler ("a", "something", "for the") is dropped. Omit text if nothing is left.

place[] describes WHERE it goes, using only refs from the room below:
- near(ref, mm?): "by", "next to", "beside", "near". mm is null unless the sentence says "within X of".
  A distance that belongs to a different phrase ("5 feet from any wall") is its own distance_min clause.
- against(ref): "against", "along", "up against".
- distance_min(ref, mm): "at least X from", "X away from", "X from".
- clear(ref, mm): "keep X clear of", "leave X in front of".
- on(ref): "on", "on top of".
- not_blocking(ref): "don't block", "not in front of", "without blocking".
Refs: "any wall"/"the walls" -> any_wall. A named wall -> wall with its id. "the window"/"the door" -> window/door;
include the id only when the room has exactly one. Something already in the room -> instance with its id.
Never reference an id that is not listed. If the sentence mentions a place the room does not have, drop that clause.

Units: 1 ft = 304.8 mm, 1 in = 25.4 mm, 1 m = 1000 mm, 1 cm = 10 mm. Round to a whole millimetre.
"5 feet" -> 1524. "30 inches" -> 762. "90cm" -> 900. "2 feet" -> 610.

qty: null unless more than one is asked for ("two chairs" -> 2).
Never emit rules the room always enforces (stay inside the room, no overlapping, door swing).
If part of the sentence does not map, drop that part and return the rest.

Example. Sentence: "a blue linen armchair by the window, at least 3 feet from the door, under $250"
{{"find":[{{"k":"category","value":"armchair"}},{{"k":"price_max","cents":25000}},{{"k":"colour","hex":"#2e5c8a"}},{{"k":"material","value":"linen"}}],"place":[{{"k":"near","ref":{{"kind":"window","id":"w1"}},"mm":null}},{{"k":"distance_min","ref":{{"kind":"door","id":"d1"}},"mm":914}}],"qty":null}}
Example. Sentence: "three tall plants for the garage"
{{"find":[{{"k":"text","q":"tall"}},{{"k":"category","value":"plant"}}],"place":[],"qty":3}}"""


def build_instructions(refs: dict) -> str:
    """The full system prompt for one room."""
    colours = ", ".join(f"{name} {hex_}" for name, hex_ in NAMED_COLOURS.items())
    rules = RULES.format(categories=", ".join(CATEGORIES), colours=colours)
    return f"{rules}\n\nRoom:\n{json.dumps(refs, separators=(',', ':'))}"
