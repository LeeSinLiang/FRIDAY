import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { instanceToAdd } from "./products";
import type { Instance, Product } from "./types";

const pose = { xCm: 860, zCm: 380, yawRad: 0 };
// What the server lists for a catalogue piece standing in the room (catalogue_product in the backend), plus the two
// fields the editor's own Product type allows and the server refuses on a carried product.
const herrakra: Product = { productId: "ikea-405.355.47", name: "HERRÅKRA armchair", widthCm: 71, depthCm: 66, heightCm: 73,
  color: "#b08d57", kind: "chair", modelUrl: "/models/furniture/herrakra.glb" };
const standing: Instance[] = [
  { instanceId: "sofa-1", productId: "sofa-grey-scan", pose: { xCm: 300, zCm: 300, yawRad: 0 } },
  { instanceId: "chair-1", productId: herrakra.productId, pose: { xCm: 955, zCm: 375, yawRad: Math.PI / 2 },
    product: { ...herrakra, thumbnailUrl: "/thumbs/herrakra.png", catalogueVisible: true } },
];

test("an add from the rail carries the product of a catalogue piece, with only the fields the server stores", () => {
  const added = instanceToAdd("new-1", herrakra.productId, pose, standing);
  assert.deepEqual(added, { instanceId: "new-1", productId: herrakra.productId, pose, product: herrakra });
  assert.deepEqual(Object.keys(added.product!).sort(), ["color", "depthCm", "heightCm", "kind", "modelUrl", "name", "productId", "widthCm"]);
});

test("an add of a shared product carries none: the server refuses a shared product with one", () => {
  const added = instanceToAdd("new-2", "sofa-grey-scan", pose, standing);
  assert.deepEqual(added, { instanceId: "new-2", productId: "sofa-grey-scan", pose });
  assert.equal("product" in added, false);
});

test("a catalogue piece without a model carries no modelUrl key at all", () => {
  const { modelUrl: _dropped, ...plain } = herrakra;
  const added = instanceToAdd("new-3", plain.productId, pose, [{ instanceId: "chair-2", productId: plain.productId, pose, product: plain }]);
  assert.equal("modelUrl" in added.product!, false);
});

test("the editor builds its add with instanceToAdd, never as a bare instance", async () => {
  const editor = await readFile(new URL("SplatEditor.tsx", `file://${process.cwd()}/src/`), "utf8");
  assert.match(editor, /instanceToAdd\(id,productId,pose,instances\)/);
  assert.match(editor, /session.submit\(\{type:"add",instance\}\)/);
  assert.doesNotMatch(editor, /type:"add",instance:\{instanceId/);
});
