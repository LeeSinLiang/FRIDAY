import assert from "node:assert/strict";
import test from "node:test";
import feed from "../../../backend/catalogue/data/listings.json";
import type { Listing } from "../lib/types";
import { applyEdit } from "../scene/commands";
import { PRODUCTS, ROOM } from "../scene/fixtures";
import { FLAT_MAX_CM, validatePlacement } from "../scene/placement";
import { productOf, productsWith } from "../scene/products";
import type { Instance } from "../scene/types";
import { parseSceneSnapshot, sceneFingerprint } from "../scene/useSceneSync";
import { instanceFromListing } from "./boundary";
import { solve } from "./solve";

const POANG_ID = "ikea-193.025.39";
// The real feed entry, not a copy. The feed has no thumb_url; the server generates it.
const poang = { ...feed.items.find((item) => item.id === POANG_ID), thumb_url: "" } as Listing;
const placed = instanceFromListing(poang, "poang-1", { xCm: 300, zCm: 250, yawRad: 0 });

test("END TO END: a POÄNG from the catalogue feed is added, validated, solved for and saved by its real id", () => {
  assert.deepEqual(placed.product, { productId: POANG_ID, name: "POÄNG armchair", widthCm: 68, depthCm: 82, heightCm: 100, color: "#c9a77c", kind: "chair" });
  // The editor's reducer accepts it although the shared product list has never heard of it.
  assert.equal(PRODUCTS.some((p) => p.productId === POANG_ID), false);
  const instances = applyEdit([], { type: "add", instance: placed }, PRODUCTS);
  assert.deepEqual(instances, [placed]);
  // The editor's placement check resolves the carried product, for the item itself and as an obstacle.
  assert.equal(validatePlacement(ROOM, PRODUCTS, instances, "poang-1", placed.pose).valid, true);
  assert.equal(validatePlacement(ROOM, PRODUCTS, instances, "poang-1", { xCm: 20, zCm: 250, yawRad: 0 }).reason, "Outside room");
  const sofa: Instance = { instanceId: "sofa-1", productId: "test-sofa", pose: { xCm: 320, zCm: 250, yawRad: 0 } };
  assert.equal(validatePlacement(ROOM, PRODUCTS, [...instances, sofa], "sofa-1", sofa.pose).reason, "Overlaps POÄNG armchair");
  // Consumers that look products up by id get it through productsWith, without touching their code.
  assert.deepEqual(productsWith(PRODUCTS, instances).map((p) => p.productId), [...PRODUCTS.map((p) => p.productId), POANG_ID]);
  assert.equal(productsWith(PRODUCTS, []), PRODUCTS);
  // The solver lights a floor for it, around the sofa.
  const solution = solve({ room: ROOM, products: PRODUCTS, instances: [sofa] }, { product: placed.product! }, [{ k: "against", ref: { kind: "any_wall" } }]);
  assert.ok(solution.legalCounts.every((count) => count > 0));
  // Saving keeps the product; loading the server's snapshot brings it back.
  assert.ok(sceneFingerprint(instances).includes('"widthCm":68'));
  const snapshot = parseSceneSnapshot({ revision: 1, room: ROOM, products: [...PRODUCTS, placed.product], instances });
  assert.deepEqual(snapshot.instances, instances);
});

test("fixture instances are unchanged: no carried product, same fingerprint, same snapshot", () => {
  const chair: Instance = { instanceId: "chair-1", productId: "test-chair", pose: { xCm: 100, zCm: 100, yawRad: 0 } };
  assert.deepEqual(applyEdit([], { type: "add", instance: chair }, PRODUCTS), [chair]);
  assert.equal(sceneFingerprint([chair]), '[{"instanceId":"chair-1","productId":"test-chair","pose":{"xCm":100,"zCm":100,"yawRad":0}}]');
  assert.deepEqual(parseSceneSnapshot({ revision: 0, room: ROOM, products: PRODUCTS, instances: [chair] }).instances, [chair]);
  // A shared product always wins over a carried one, so a client cannot redefine a fixture.
  const spoofed = { ...chair, product: { ...PRODUCTS[2], widthCm: 1 } };
  assert.equal(productOf(spoofed, PRODUCTS)?.widthCm, PRODUCTS[2].widthCm);
  assert.deepEqual(applyEdit([], { type: "add", instance: spoofed }, PRODUCTS), [chair]);
});

test("malformed or unknown products never enter editor state", () => {
  const bad: [string, Instance][] = [
    ["unknown id, nothing carried", { instanceId: "x", productId: "made-up", pose: placed.pose }],
    ["carried id differs", { ...placed, product: { ...placed.product!, productId: "other" } }],
    ["zero width", { ...placed, product: { ...placed.product!, widthCm: 0 } }],
    ["bad kind", { ...placed, product: { ...placed.product!, kind: "bed" as never } }],
  ];
  for (const [name, instance] of bad) {
    assert.deepEqual(applyEdit([], { type: "add", instance }, PRODUCTS), [], name);
    assert.throws(() => parseSceneSnapshot({ revision: 1, room: ROOM, products: [...PRODUCTS, { productId: instance.productId }], instances: [instance] }), name);
  }
  // The server must also list it: a snapshot whose products lack the id is rejected.
  assert.throws(() => parseSceneSnapshot({ revision: 1, room: ROOM, products: PRODUCTS, instances: [placed] }));
});

// ---- A rug does not stop a chair. Real listings: LOHALS 200 x 300 x 1.0 cm, VINDUM 133 x 180 x 3.0 cm (exactly the line). ----

const item = (id: string) => ({ ...feed.items.find((entry) => entry.id === id), thumb_url: "" }) as Listing;
const byTitle = (word: string) => item(feed.items.find((entry) => entry.title.startsWith(word))!.id);

test("a rug neither blocks nor is blocked: furniture stands on it, and it goes under furniture already there", () => {
  const lohals = byTitle("LOHALS"), vindum = byTitle("VINDUM");
  assert.deepEqual([lohals.dims_mm.h, vindum.dims_mm.h, FLAT_MAX_CM], [10, 30, 3], "VINDUM's 3.0 cm pile is exactly the line, and counts as flat");
  const rug = instanceFromListing(lohals, "rug-1", { xCm: 300, zCm: 250, yawRad: 0 });
  const chair = instanceFromListing(poang, "poang-1", { xCm: 300, zCm: 250, yawRad: 0 }); // dead centre of the rug

  // Chair onto a rug that is already down.
  assert.equal(validatePlacement(ROOM, PRODUCTS, [rug, chair], "poang-1", chair.pose).valid, true);
  // Rug under a chair that is already there, and a second rug overlapping the first.
  assert.equal(validatePlacement(ROOM, PRODUCTS, [chair, rug], "rug-1", rug.pose).valid, true);
  const pile = instanceFromListing(vindum, "rug-2", { xCm: 320, zCm: 260, yawRad: 0 });
  assert.equal(validatePlacement(ROOM, PRODUCTS, [rug, pile], "rug-2", pile.pose).valid, true);
  // A rug is still an item in a room: it cannot hang over the wall.
  assert.equal(validatePlacement(ROOM, PRODUCTS, [rug], "rug-1", { xCm: 50, zCm: 250, yawRad: 0 }).reason, "Outside room");

  // One millimetre over the line and it is furniture again.
  const slab = { ...rug, instanceId: "slab-1", product: { ...rug.product!, productId: "slab", heightCm: 3.1 }, productId: "slab" };
  assert.equal(validatePlacement(ROOM, PRODUCTS, [slab, chair], "poang-1", chair.pose).valid, false);
});

test("the lit floor agrees: a rug takes nothing away from where a chair may go, and the rug's own region ignores the chair", () => {
  const rug = instanceFromListing(byTitle("LOHALS"), "rug-1", { xCm: 300, zCm: 250, yawRad: 0 });
  const chair = instanceFromListing(poang, "poang-1", { xCm: 300, zCm: 250, yawRad: 0 });
  const bare = solve({ room: ROOM, products: PRODUCTS, instances: [] }, { product: chair.product! }, []).legalCounts;
  const onRug = solve({ room: ROOM, products: PRODUCTS, instances: [rug] }, { product: chair.product! }, []).legalCounts;
  assert.deepEqual(onRug, bare, "before this rule the rug cut a 2 x 3 m hole in the chair's region");
  const rugAlone = solve({ room: ROOM, products: PRODUCTS, instances: [] }, { product: rug.product! }, []).legalCounts;
  const rugWithChair = solve({ room: ROOM, products: PRODUCTS, instances: [chair] }, { product: rug.product! }, []).legalCounts;
  assert.deepEqual(rugWithChair, rugAlone);
  assert.ok(rugAlone[0] > 0);
});
