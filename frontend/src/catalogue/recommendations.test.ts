import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { isDictationShortcut } from "./dictationShortcut";
import { listingImageUrl } from "./ListingImage";
import previews from "../../../shared/catalogue-thumbnails.json";
import { browseCatalogue } from "./browse";
import { searchCatalogue } from "./api";
import type { Listing } from "../lib/types";

const key = { key: "d", metaKey: true, ctrlKey: false, shiftKey: true, altKey: false, repeat: false, isComposing: false };
test("dictation accepts its explicit chord, never walking, typing, repeats or composition", () => {
  assert.equal(isDictationShortcut(key), true);
  assert.equal(isDictationShortcut({ ...key, key: "D" }), true);
  assert.equal(isDictationShortcut({ ...key, metaKey: false, ctrlKey: true }), true);
  for (const change of [{ shiftKey: false }, { metaKey: false }, { altKey: true }, { repeat: true }, { isComposing: true }, { key: "s" }])
    assert.equal(isDictationShortcut({ ...key, ...change }), false);
});
test("a product photo wins, generated initial tiles resolve only to the same model's thumbnail", () => {
  const model_url = "/models/furniture/abo-B075ZBW22K/model.glb";
  assert.equal(listingImageUrl({ model_url, thumb_url: "https://example.com/exact-product.jpg" }), "https://example.com/exact-product.jpg");
  assert.equal(listingImageUrl({ model_url, thumb_url: "data:image/svg+xml;utf8,initials" }), "/models/furniture/abo-B075ZBW22K/thumbnail.png");
  assert.equal(listingImageUrl({ model_url: null, thumb_url: "data:image/svg+xml;utf8,initials" }), undefined);
  assert.equal(listingImageUrl({ model_url: "/models/furniture/unknown/model.glb", thumb_url: "" }), undefined);
});
test("every deployed catalogue model has a packaged PNG preview associated with its own directory", async () => {
  const feed = JSON.parse(await readFile(new URL("../backend/catalogue/data/listings.json", `file://${process.cwd()}/`), "utf8"));
  for (const item of feed.items) {
    if (!item.model_url?.startsWith("/models/furniture/")) continue;
    const url = (previews as Record<string,string>)[item.model_url];
    assert.equal(url, item.model_url.replace(/[^/]+$/, "thumbnail.png"), item.id);
    const path = new URL(`../shared${url}`, `file://${process.cwd()}/`);
    assert.ok((await stat(path)).size > 0, item.id);
    assert.deepEqual([...new Uint8Array(await readFile(path)).slice(0,8)], [137,80,78,71,13,10,26,10], item.id);
  }
});

test("category cards use the fixed render of their exact model even when a photo is available", () => {
  assert.equal(listingImageUrl({ model_url: "/models/furniture/abo-B075ZBW22K/model.glb", thumb_url: "https://example.com/product.jpg" }, true), "/models/furniture/abo-B075ZBW22K/thumbnail.png");
});

test("category browsing unions the real categories and caps the stable model-only list at 20", async t => {
  const urls: URL[] = [];
  const signal = new AbortController().signal;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input, "http://localhost"); urls.push(url);
    assert.equal(init.signal, signal);
    const category = url.searchParams.get("category")!;
    assert.equal(url.searchParams.get("limit"), "20");
    assert.equal(url.searchParams.get("models"), "only");
    const items = Array.from({length: 15}, (_, i) => ({ id: `${category}-${String(i).padStart(2, "0")}`, category, model_url: `/models/furniture/${category}-${i}/model.glb` } as Listing));
    return new Response(JSON.stringify({ items, total: 15 }));
  });
  const result = await browseCatalogue("Tables", signal);
  assert.deepEqual(urls.map(url => url.searchParams.getAll("category")), [["table"], ["desk"]]);
  assert.equal(result.total, 30);
  assert.equal(result.items.length, 20);
  assert.equal(result.items[0].id, "desk-00");
  assert.equal(result.items[19].id, "table-04");
});

test("empty model categories stay empty; AI search retains its original request defaults", async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    urls.push(new URL(input, "http://localhost"));
    return new Response(JSON.stringify({ items: [], total: 0 }));
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await browseCatalogue("Plants", signal), { items: [], total: 0 });
  await searchCatalogue([{ k: "text", q: "a reading chair" }], signal);
  assert.equal(urls[0].searchParams.get("category"), "plant");
  assert.equal(urls[1].searchParams.get("limit"), "12");
  assert.equal(urls[1].searchParams.has("models"), false);
});
