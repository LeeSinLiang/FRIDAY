import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pieceInHand, walkKeyAction, type WalkKeyState } from "./walkKeys";

const press = (key: string, extra: Partial<{ repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  ({ key, repeat: false, metaKey: false, ctrlKey: false, altKey: false, ...extra });
const walking: WalkKeyState = { mode: "walk", pointerLocked: false, active: false, pieceInHand: false };
const MOVEMENT_AND_F = ["w", "a", "s", "d", "W", "A", "S", "D", "f", "F"];

test("with nothing in hand the walk keys behave as they always have", () => {
  for (const key of ["w", "a", "s", "d", "W", "A", "S", "D"]) assert.equal(walkKeyAction(press(key), walking), "capture", key);
  for (const key of ["f", "F"]) assert.equal(walkKeyAction(press(key), walking), "toggle", key);
  assert.equal(walkKeyAction(press("w"), { ...walking, mode: "explore" }), null, "W A S D only reach for the pointer in walk mode");
  assert.equal(walkKeyAction(press("w"), { ...walking, pointerLocked: true }), null, "already captured");
  assert.equal(walkKeyAction(press("w", { repeat: true }), walking), null, "a held key asks once");
  assert.equal(walkKeyAction(press("f"), { ...walking, mode: "explore" }), "toggle", "F enters walking from anywhere");
  assert.equal(walkKeyAction(press("f"), { ...walking, pointerLocked: true }), "toggle", "F leaves a captured walk");
  assert.equal(walkKeyAction(press("f", { metaKey: true }), walking), null, "Cmd+F is the browser's");
  assert.equal(walkKeyAction(press("f"), { ...walking, active: true }), null, "not during a save or a drag");
  assert.equal(walkKeyAction(press("e"), walking), null);
});

test("with a piece from the furniture rail in hand, W A S D and F do nothing", () => {
  const holding = pieceInHand("sofa-grey-scan", { externalHold: false });
  assert.equal(holding, true);
  for (const key of MOVEMENT_AND_F) assert.equal(walkKeyAction(press(key), { ...walking, pieceInHand: holding }), null, key);
});

test("with a piece from the search panel in hand, W A S D and F do nothing", () => {
  // The panel's hold is not pendingProductId: it is runtime.externalHold, set by SplatCatalogueLayer.
  const holding = pieceInHand(null, { externalHold: true });
  assert.equal(holding, true, "the search panel's hold counts as a piece in hand");
  for (const key of MOVEMENT_AND_F) assert.equal(walkKeyAction(press(key), { ...walking, pieceInHand: holding }), null, key);
  assert.equal(pieceInHand(null, { externalHold: false }), false);
  assert.equal(pieceInHand(null, null), false, "no engine yet");
});

test("the editor asks about both hands, in its key handler and before it captures the pointer", async () => {
  const editor = await readFile(new URL("SplatEditor.tsx", `file://${process.cwd()}/src/`), "utf8");
  assert.match(editor, /walkKeyAction\(e,\{mode,pointerLocked,active,pieceInHand:pieceInHand\(pendingProductId,runtime\.current\)\}\)/);
  assert.match(editor, /view==="top"\|\|pieceInHand\(pendingProductId,runtime\.current\)\)return;/, "startWalk: F and the Capture pointer button");
  assert.doesNotMatch(editor, /\/\^\[wasd\]\$\/i\.test\(e\.key\)/, "no second, ungated W A S D check in the editor");
});
