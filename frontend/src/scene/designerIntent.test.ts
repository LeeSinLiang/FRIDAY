import assert from "node:assert/strict";
import test from "node:test";
import { isDesignerRequest } from "./designerIntent";

test('explicit room edits and inspections route to the designer without hijacking catalogue queries', () => {
  for (const text of ['place a chair 60cm right of the table', 'Can you please move it behind the sofa', 'remove the selected chair', 'what is in this room?', 'put a lamp on the table'])
    assert.equal(isDesignerRequest(text), true, text);
  for (const text of ['an armchair', 'a chair next to the sofa', 'find a red chair', 'place mats', 'please find a lamp under $100'])
    assert.equal(isDesignerRequest(text), false, text);
});
