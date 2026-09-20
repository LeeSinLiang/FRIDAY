import assert from "node:assert/strict";
import test from "node:test";
import { designerInstruction, isDesignerRequest, isDoItNowCue, isBedroomDesignRequest, isDesignLockRequest } from "./designerIntent";

test('explicit room edits and inspections route to the designer without hijacking catalogue queries', () => {
  for (const text of ['place a chair 60cm right of the table', 'Can you please move it behind the sofa', 'remove the selected chair', 'what is in this room?', 'put a lamp on the table'])
    assert.equal(isDesignerRequest(text), true, text);
  for (const text of ['an armchair', 'a chair next to the sofa', 'find a red chair', 'place mats', 'please find a lamp under $100'])
    assert.equal(isDesignerRequest(text), false, text);
});

test('the exact bedroom conversation routes design, active refinement and lock-in', () => {
  const brief = 'I have a $1200 budget. Design me a warm bedroom. I want a couch beside the bed.';
  assert.equal(designerInstruction(brief), brief);
  assert.equal(isBedroomDesignRequest(brief), true);
  assert.equal(isBedroomDesignRequest('$1200 warm bedroom couch beside bed'), true);
  const spokenPlan = 'Hey Friday, with 1200 budget, um help me plan room. I want a couch beside the bed.';
  assert.equal(isBedroomDesignRequest(spokenPlan), true);
  assert.equal(designerInstruction(spokenPlan), spokenPlan);
  assert.equal(designerInstruction('Actually, change the couch to a more brownish color.'), 'Actually, change the couch to a more brownish color.');
  assert.equal(isDesignLockRequest('OK, lock it in.'), true);
  assert.equal(designerInstruction('OK, lock it in.'), 'OK, lock it in.');
  assert.equal(isBedroomDesignRequest('find a warm bedroom chair under $200'), false);
});

test('natural Deepgram wording preserves the whole brief and routes refinement and lock before search', () => {
  const brief = 'I have a twelve hundred dollar budget. Design me a warm bedroom. I want a couch beside the bed.';
  const refinement = 'Actually I want to change the couch to a more brownish color.';
  const lock = 'Okay I want to lock it in';
  for (const text of [brief, refinement, lock]) {
    assert.equal(designerInstruction(text), text, 'the transcript must reach onDesign without losing its budget or intent');
    assert.equal(isDesignerRequest(text), true);
  }
  assert.equal(isBedroomDesignRequest(brief), true);
  assert.equal(isDesignLockRequest(brief), false);
  assert.equal(isBedroomDesignRequest(refinement), false);
  assert.equal(isDesignLockRequest(refinement), false);
  assert.equal(isDesignLockRequest(lock), true);
  // Describing a product remains catalogue search, even with the same color.
  assert.equal(designerInstruction('Find a brown couch for my bedroom'), null);
});

test('do it now routes a spoken or typed placement to the same scene agent instruction', () => {
  assert.equal(designerInstruction('Put the lamp on the desk, do it now!'), 'Put the lamp on the desk');
  assert.equal(designerInstruction('Do it now: place a coffee cup on the table'), 'place a coffee cup on the table');
  assert.equal(designerInstruction('A desk by the window. Do it now.'), 'Place A desk by the window');
  assert.equal(designerInstruction('Do it now', 'Place the lamp on the table'), 'Place the lamp on the table');
  assert.equal(designerInstruction('Do it now', ''), null);
  assert.equal(designerInstruction("Okay. I don't wanna be stuck. No worries. Place a desk here. Do it now. Well, those just"), 'Place a desk here');
  assert.equal(designerInstruction('Place a desk here. Do it now. Thanks'), 'Place a desk here');
  const workstation = 'Design a complete workstation here: place a desk, then put a display monitor, keyboard, mouse, and desk lamp on its desktop. Add a chair in front of the desk. Keep every item inside the room and avoid overlaps.';
  assert.equal(designerInstruction(`${workstation} Do it now.`), workstation.slice(0, -1));
  assert.equal(isDoItNowCue('Do it now!'), true);
  assert.equal(isDesignerRequest('Place the lamp on the table, do it now'), true);
  assert.equal(isDesignerRequest('Do it now'), false);
  assert.equal(isDesignerRequest('find a lamp under $100'), false);
});
