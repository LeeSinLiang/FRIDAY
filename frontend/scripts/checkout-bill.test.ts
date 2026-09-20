// Lives in scripts/ like the other node-run tests: tsc (src only) does not allow the .ts import node needs.
import assert from "node:assert/strict";
import test from "node:test";
import { billLine, isPriced, vendorLine } from "../src/checkout/types.ts";

test("a bill says how much of it could be priced, in the house voice", () => {
  assert.equal(billLine(48, 31, 1248000), "48 items · 31 priced · $12,480");
  assert.equal(billLine(3, 3, 162399), "3 items · $1,623.99", "nothing to qualify when every piece has a price");
  assert.equal(billLine(1, 1, 14900), "1 item · $149");
  assert.equal(billLine(1200, 800, 5000000), "1,200 items · 800 priced · $50,000");
  assert.equal(billLine(5, 0, 0), "5 items · none priced yet", "never $0 for a bill nobody could price");
});

test("a line with no known price is unpriced, never zero", () => {
  assert.equal(isPriced({ priced: false, line_amount: null }), false);
  assert.equal(isPriced({ priced: true, line_amount: 14900 }), true);
  assert.equal(isPriced({ line_amount: 14900 }), true, "a checkout saved before lines carried `priced`");
  assert.equal(isPriced({ line_amount: null }), false);
});

test("a bill says who its pieces come from, which is not who is paid", () => {
  const amazon = { id: "amazon", name: "Amazon" }, ikea = { id: "ikea", name: "IKEA" };
  const lines = [{ vendor: ikea, quantity: 2 }, { vendor: amazon, quantity: 40 }, { vendor: amazon, quantity: 6 }, { vendor: null, quantity: 1 }];
  assert.equal(vendorLine(lines), "Amazon 46 · IKEA 2");
  assert.equal(vendorLine([{ quantity: 3 }]), "", "a checkout saved before lines carried a vendor");
});
