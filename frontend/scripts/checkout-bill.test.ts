// Lives in scripts/ like the other node-run tests: tsc (src only) does not allow the .ts import node needs.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { billLine, isPriced, vendorLine } from "../src/checkout/types.ts";
import { cartLines, linePrice, stageLines } from "../src/checkout/cartLines.ts";
import { roomCheckoutLines, sandboxDispatchVerified } from "../src/checkout/roomCheckoutPresentation.ts";
import { approveAndSubmitCheckout } from "../src/checkout/approveAndSubmit.ts";

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

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

test("the cart choreography shows the real cart: one line per product, real quantities, and no price where none is known", () => {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const chair = { product_id: "ikea-405.355.47", name: "HERRÅKRA armchair", thumbnail: "/t/h.png", unit_amount: 14900, priced: true, vendor: { name: "IKEA" } };
  const abo = { product_id: "abo-B071W5VJFK", name: "Rivet Cove accent chair", thumbnail: "data:image/svg+xml,x", unit_amount: 0, priced: false, vendor: { name: "Amazon" } };
  const lines = cartLines([chair, abo, chair]);
  assert.deepEqual(lines.map(line => [line.name, line.quantity, line.vendor]), [["HERRÅKRA armchair", 2, "IKEA"], ["Rivet Cove accent chair", 1, "Amazon"]]);
  assert.deepEqual(lines.map(line => linePrice(line, dollars)), ["2 × $149.00", "price unavailable"], "an unknown price never reads $0");
  assert.deepEqual(cartLines([]), [], "an empty cart has nothing to gather");
});

test("a building's bill does not flood the stage", () => {
  const lines = cartLines(Array.from({ length: 30 }, (_, n) => ({ product_id: `p${n}`, name: `Piece ${n}`, thumbnail: "", unit_amount: 100, priced: true })));
  assert.deepEqual([stageLines(lines).shown.length, stageLines(lines).more], [7, 23]);
  assert.deepEqual([stageLines(lines.slice(0, 8)).shown.length, stageLines(lines.slice(0, 8)).more], [8, 0]);
});

test("one explicit approval action sends exactly one sandbox request after MFA succeeds", async () => {
  const checkout = { id: "checkout-1", state: "draft", snapshot_hash: "hash-1" } as any;
  const calls: Array<[string, string, unknown]> = [];
  const send = async (path: string, method: string, body: unknown) => {
    calls.push([path, method, body]);
    if (path.endsWith("/approve/")) return { status: 200, data: { ...checkout, state: "approved" } };
    return { status: 200, data: { ...checkout, state: "accepted" } };
  };
  const result = await approveAndSubmitCheckout(checkout, true, "123456", send);
  assert.equal(result.state, "accepted");
  assert.deepEqual(calls, [
    ["/api/checkouts/checkout-1/approve/", "POST", { snapshot_hash: "hash-1", approved: true, code: "123456" }],
    ["/api/checkouts/checkout-1/submit/", "POST", { snapshot_hash: "hash-1" }],
  ]);

  let submits = 0;
  await assert.rejects(approveAndSubmitCheckout(checkout, true, "000000", async path => {
    if (path.endsWith("/submit/")) submits++;
    return { status: 400, errors: [{ message: "Invalid authenticator code." }] };
  }), /Invalid authenticator code/);
  assert.equal(submits, 0, "a rejected MFA code never reaches Visa");
});

test("the cart preview is folded into the cart: no separate destination, no sample data, nothing on the sign-in steps", async () => {
  const [app, ready, choreography, account, review, approval] = await Promise.all(
    ["App.tsx", "shopping/CartReady.tsx", "checkout/CartChoreography.tsx", "auth/AccountApp.tsx", "checkout/CheckoutReview.tsx", "checkout/ApprovalForm.tsx"].map(source));
  assert.doesNotMatch(app, /cartPreview/i, "the ?cartPreview route is retired");
  await assert.rejects(source("checkout/CartPreview.tsx"), "the standalone page is gone");
  assert.doesNotMatch(choreography, /Modular sofa|LISABO|thumbnail\.png/, "no sample pieces: the stage shows what /api/cart/ returned");
  assert.doesNotMatch(choreography, /SplatEditor|PlayCanvas|<video|<canvas|observation/, "no room, no WebGL and no film on the account pages");
  assert.match(choreography, /prefers-reduced-motion/, "reduced motion goes straight to the finished state");
  // Found by eye, not by this suite: an "already played" ref set when the gathering STARTED survived StrictMode's
  // second mount effect, so in development the pieces never gathered at all. No test renderer here can run effects,
  // so this only keeps the ref from coming back; the animation itself was checked in a browser.
  assert.doesNotMatch(choreography, /useRef/, "no ref that outlives StrictMode's double mount effect");
  assert.match(ready, /location\.pathname === '\/cart' && !!cart\?\.items\.length && <CartChoreography/, "only on the cart, and never for an empty one");
  // The hard line: sign-in, the authenticator step and the review step never mount it. Only CartReady does.
  for (const [name, text] of [["AccountApp.tsx", account], ["CheckoutReview.tsx", review], ["ApprovalForm.tsx", approval]] as const)
    assert.doesNotMatch(text, /CartChoreography/, `${name} must not mount the choreography`);
});


test("room checkout film requires an accepted matching sandbox result, never just approval or HTTP success", () => {
  const accepted = {state:"accepted",evidence:{http_status:200,transaction_id_matches:true,response:{idxMatchKey:"test-match"}}} as any;
  assert.equal(sandboxDispatchVerified(accepted),true);
  for(const state of ["draft","approved","submitting","transport_unknown","failed"])
    assert.equal(sandboxDispatchVerified({...accepted,state}),false,state);
  assert.equal(sandboxDispatchVerified({...accepted,evidence:{...accepted.evidence,transaction_id_matches:false}}),false);
  assert.equal(sandboxDispatchVerified({...accepted,evidence:{...accepted.evidence,http_status:500}}),false);
  assert.equal(sandboxDispatchVerified({...accepted,evidence:{...accepted.evidence,response:{idxMatchKey:""}}}),false);
  assert.equal(sandboxDispatchVerified(null),false);
});

test("room approval displays immutable checkout prices even if the current cart has changed", () => {
  const cart={items:[{product_id:"chair",name:"New chair",thumbnail:"/actual-chair.png",priced:true,unit_amount:9900}],amount:9900} as any;
  const checkout={snapshot:{items:[{product_id:"chair",name:"Reviewed chair",quantity:2,priced:true,line_amount:12000},{product_id:"lamp",name:"Lamp",quantity:1,priced:false,line_amount:null}]}} as any;
  assert.deepEqual(roomCheckoutLines(cart,checkout,cartLines(cart.items)),[
    {id:"chair",name:"Reviewed chair",quantity:2,thumbnail:"/actual-chair.png",amount:12000},
    {id:"lamp",name:"Lamp",quantity:1,thumbnail:"",amount:null},
  ]);
});
