import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editor = () => readFile(new URL("SplatEditor.tsx", `file://${process.cwd()}/src/`), "utf8");

test("the search panel is open when a room loads, in shopping mode as much as on the plain route", async () => {
  const source = await editor();
  assert.match(source, /const \[shopSearchOpen,setShopSearchOpen\]=useState\(true\);/);
  assert.doesNotMatch(source, /useState\(!shopping\)/, "shopping mode (/room/<id>, the demo route) must not start with it closed");
});

test("recommendations dock into the furniture panel and reuse the catalogue placement layer", async () => {
  const source = await editor();
  assert.match(source, /shelfTarget=\{catalogueTarget\}/);
  assert.match(source, /recommendationTargetRef=\{setCatalogueTarget\}/);
  assert.match(source, /showShelf=\{shopSearchOpen&&panelOpen&&panel==="catalogue"\}/);
  assert.match(source, /onOpenLiveCatalogue=\{openRecommendations\}/);
  assert.match(source, /onBrowseCategory=\{\(\)=>setShopSearchOpen\(false\)\}/);
});

test("the floor map keeps its full view now that search is on the right", async () => {
  const source = await editor();
  assert.doesNotMatch(source, /compact=\{shopSearchOpen\}/);
});
