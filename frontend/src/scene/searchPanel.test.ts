import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editor = () => readFile(new URL("SplatEditor.tsx", `file://${process.cwd()}/src/`), "utf8");

test("the search panel is open when a room loads, in shopping mode as much as on the plain route", async () => {
  const source = await editor();
  assert.match(source, /const \[shopSearchOpen,setShopSearchOpen\]=useState\(true\);/);
  assert.doesNotMatch(source, /useState\(!shopping\)/, "shopping mode (/room/<id>, the demo route) must not start with it closed");
});

test("Close search closes it, and only the rail's button opens it again", async () => {
  const source = await editor();
  assert.match(source, /onCloseShelf=\{\(\)=>setShopSearchOpen\(false\)\}/);
  assert.match(source, /onOpenLiveCatalogue=\{\(\)=>\{setPanelOpen\(false\);setMode\("explore"\);setShopSearchOpen\(true\);\}\}/);
  assert.equal(source.split("setShopSearchOpen(true)").length - 1, 1, "nothing else reopens a panel the presenter closed");
});
