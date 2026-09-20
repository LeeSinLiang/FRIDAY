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

test("with the search panel open the floor map collapses instead of hiding under it", async () => {
  const source = await editor();
  assert.match(source, /<FloorMap [^>]*compact=\{shopSearchOpen\}/, "the editor tells the map when the panel owns the corner");
  const map = await readFile(new URL("scene/FloorMap.tsx", `file://${process.cwd()}/src/`), "utf8");
  assert.match(map, /compact \? " is-compact" : expanded \? " is-expanded" : ""/);
  const css = await readFile(new URL("splat-editor.css", `file://${process.cwd()}/src/`), "utf8");
  const rule = css.split("\n").find((line) => line.startsWith(".floor-map.is-compact {")) ?? "";
  assert.match(rule, /top:162px;bottom:auto;/, "above the panel, not in its corner");
  assert.doesNotMatch(rule, /display:none/, "collapsed, never hidden");
  const hidden = css.split("\n").find((line) => line.includes(".floor-map.is-compact .floor-map-viewport")) ?? "";
  assert.doesNotMatch(hidden, /floor-map-levels|floor-map-title|floor-map-heading/, "the floor number and its up/down controls stay");
});
