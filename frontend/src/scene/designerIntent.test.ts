import assert from "node:assert/strict";
import test from "node:test";
import { designerInstruction, isDesignerRequest, isDoItNowCue } from "./designerIntent";

test('explicit room edits and inspections route to the designer without hijacking catalogue queries', () => {
  for (const text of ['place a chair 60cm right of the table', 'Can you please move it behind the sofa', 'remove the selected chair', 'what is in this room?', 'put a lamp on the table'])
    assert.equal(isDesignerRequest(text), true, text);
  for (const text of ['an armchair', 'a chair next to the sofa', 'find a red chair', 'place mats', 'please find a lamp under $100'])
    assert.equal(isDesignerRequest(text), false, text);
});

test('do it now routes a spoken or typed placement to the same scene agent instruction', () => {
  assert.equal(designerInstruction('Put the lamp on the desk, do it now!'), 'Put the lamp on the desk');
  assert.equal(designerInstruction('Do it now: place a coffee cup on the table'), 'place a coffee cup on the table');
  assert.equal(designerInstruction('A desk by the window. Do it now.'), 'Place A desk by the window');
  assert.equal(designerInstruction('Do it now', 'Place the lamp on the table'), 'Place the lamp on the table');
  assert.equal(designerInstruction('Do it now', ''), null);
  assert.equal(designerInstruction("Okay. I don't wanna be stuck. No worries. Place a desk here. Do it now. Well, those just"), 'Place a desk here');
  assert.equal(designerInstruction('Place a desk here. Do it now. Thanks'), 'Place a desk here');
  assert.equal(isDoItNowCue('Do it now!'), true);
  assert.equal(isDesignerRequest('Place the lamp on the table, do it now'), true);
  assert.equal(isDesignerRequest('Do it now'), false);
  assert.equal(isDesignerRequest('find a lamp under $100'), false);
});
