import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { isDictationShortcut } from "./dictationShortcut";
import { listingImageUrl } from "./ListingImage";
import previews from "../../../shared/catalogue-thumbnails.json";

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
