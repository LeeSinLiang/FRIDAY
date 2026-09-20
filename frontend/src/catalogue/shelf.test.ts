import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (name: string) => readFile(new URL(name, `file://${process.cwd()}/src/catalogue/`), "utf8");
const initialWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

test("what changes on hover sits in a fixed-height slot, so the card under a still pointer never becomes another card", async () => {
  const css = await source("shelf.css");
  const rule = css.match(/\.shelf-explain \{([^}]*)\}/)?.[1] ?? "";
  assert.match(rule, /(^|[\s;])height: \d+px/, "a fixed height, not min-height or auto: the panel is bottom-anchored at its max height");
  assert.match(rule, /overflow-y: auto/, "longer text scrolls inside the slot instead of pushing the list");
  assert.match(css, /\.shelf-explain\.dev \{[^}]*height: \d+px/, "?dev=1 shows two more lines and needs its own fixed height");

  const tsx = await source("CatalogueShelf.tsx");
  const open = tsx.indexOf('"shelf-explain dev"');
  const close = tsx.indexOf("</div>", open); // the slot's own closing tag: the first one after it opens
  const order = [open, tsx.indexOf("<Status "), tsx.indexOf('className="shelf-dropped"'), close, tsx.indexOf('className={`shelf-results')];
  assert.ok(order.every((at) => at >= 0), "markers present");
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "the status and the set-aside clauses are inside the slot, and the list comes after it");
});

test("the count line keeps the catalogue-wide number on screen when only listings with models are returned", async t => {
  // Imported lazily: CatalogueShelf reads window.location at module load, which node does not have.
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  (globalThis as { window?: unknown }).window ??= { location: { search: "" } };
  const { countLine } = await import("./CatalogueShelf");
  assert.equal(countLine(392, 392, 12), "392 matches, showing 12"); // filter off: as before
  assert.equal(countLine(1, 392, 1), "392 matches in the catalogue · 1 ready in 3D");
  assert.equal(countLine(40, 1006, 12), "1,006 matches in the catalogue · 40 ready in 3D, showing 12");
  assert.equal(countLine(0, 25, 0), "25 matches in the catalogue · none has a 3D model yet");
  assert.equal(countLine(1, null, 1), "1 match");
  // Models-first mode: nothing is excluded, so total equals matches; the 3D ones are on top.
  assert.equal(countLine(1006, 1006, 12, 1), "1,006 matches · 1 ready in 3D, shown first");
  assert.equal(countLine(1006, 1006, 12, 12), "1,006 matches, showing 12", "a page that is ALL models cannot know how many more there are");
  assert.equal(countLine(1006, 1006, 12, 0), "1,006 matches, showing 12");
});

test("catalogue import restores the window global before room-session tests run", () => {
  assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, "window"), initialWindow);
});

test("a listing with no known price says so, and never reads $0", async () => {
  const { hasPrice, priceLabel } = await import("./price");
  const dollars = (cents: number) => `$${cents / 100}`;
  assert.deepEqual([hasPrice(0), hasPrice(1), hasPrice(14900)], [false, true, true]);
  assert.equal(priceLabel(14900, dollars), "$149");
  assert.equal(priceLabel(0, dollars), "price unavailable");
  // Both places that print a price go through it.
  for (const file of ["CatalogueShelf.tsx", "../dev/search.tsx"]) {
    const text = await source(file);
    assert.match(text, /priceLabel\((listing|item)\.price_cents, dollars\)/, `${file} prints prices through priceLabel`);
    assert.doesNotMatch(text, /\{dollars\((listing|item)\.price_cents\)\}/, `${file} must not print a raw price`);
  }
  // The placement-confirm panel printed "$0.00 USD" for a piece whose price nobody knows.
  const layer = await source("SplatCatalogueLayer.tsx");
  assert.match(layer, /priceLabel\(purchase\.price_cents,/, "the confirm panel prints its price through priceLabel");
  assert.doesNotMatch(layer, /\$\{\(purchase\.price_cents\/100\)\.toFixed\(2\)\} USD/, "never a raw price in the confirm panel");
});

test("in the shop a piece is pickable for its deployed model; an unknown price does not lock the card", async t => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  (globalThis as { window?: unknown }).window ??= { location: { search: "" } };
  const { canPickInShop } = await import("./CatalogueShelf");
  assert.equal(canPickInShop({ model_url: "/models/furniture/abo-B082BLFMRC/model.glb" }), true, "an Amazon Berkeley Objects chair: model, capitals, no price");
  assert.equal(canPickInShop({ model_url: "/models/furniture/herrakra-armchair-diseroed-dark-yellow/model.glb" }), true);
  assert.equal(canPickInShop({ model_url: null }), false, "no model deployed: nothing to place");
  assert.equal(canPickInShop({ model_url: "https://elsewhere.example/model.glb" }), false, "only models packaged with the app");
  const tsx = await source("CatalogueShelf.tsx");
  assert.doesNotMatch(tsx, /price_cents <= 0/, "the price must not decide whether a card can be picked");
  assert.doesNotMatch(tsx, /Preview model unavailable/, "that label was false for a piece that has a model and no known price");
});
