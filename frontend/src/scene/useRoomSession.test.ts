import assert from "node:assert/strict";
import test from "node:test";
import scanManifest from "../../../shared/rooms/studio-11/manifest.json";
import spatial from "../../../shared/rooms/studio-11/spatial.json";
import { PRODUCTS, ROOM } from "./fixtures";
import { createRoomSession, parseRoomSnapshot, type RoomSnapshot } from "./useRoomSession";
import type { Instance, SceneEdit } from "./types";

const item: Instance = { instanceId: "one", productId: PRODUCTS[0].productId, pose: { xCm: 200, zCm: 200, yawRad: 0 } };
const payload = (revision = 0, instances: Instance[] = []): RoomSnapshot => ({ room: ROOM, products: PRODUCTS, revision, instances, geometryRevision: String(ROOM.revision) });
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test('designer retries the same frozen request and creates one normal undo entry', async t => {
  const h = harness(); t.after(h.session.dispose); await h.ready();
  const task = h.session.design('place a chair beside the table', null, null);
  assert.equal(h.requests[1].url, `/api/designer/?roomId=${ROOM.roomId}`);
  const original = h.body(1);
  assert.equal(original.baseRevision, 0);
  h.requests[1].reject(new Error('reply lost after commit'));
  assert.equal((await task).ok, false);
  const retry = h.session.retry();
  assert.deepEqual(h.body(2), original);
  h.respond(2, {scene:payload(1, [item]), designer:{appliedCount:1, message:'Chair placed.', visualNote:'Both visible.'}});
  assert.equal(await retry, true);
  assert.equal(h.state().message, 'Layout saved. Chair placed. Both visible.');
  assert.equal(h.state().canUndo, true);
  const undo = h.session.undo();
  assert.deepEqual(h.body(3).commands, [{type:'remove',instanceId:'one'}]);
  h.respond(3,payload(2)); await undo;
  assert.equal(h.state().canUndo, false);
  assert.equal(h.state().canRedo, true);
});

test('designer clarification adds no undo history and an intervening poll invalidates selection context', async t => {
  const h = harness(); t.after(h.session.dispose); await h.ready([item]);
  const task = h.session.design('move the chair', 'one', null);
  h.respond(1, {scene:payload(0,[item]), designer:{appliedCount:0,message:'Which direction?'}});
  assert.equal((await task).ok, true);
  assert.equal(h.state().canUndo, false);
  const poll = h.session.load();
  const stale = h.session.design('move it left', 'one', null);
  h.respond(2,payload(1,[])); await poll;
  assert.equal((await stale).ok, false);
  assert.equal(h.requests.length, 3);
});

test('designer async polling waits for the accepted layout and terminal failure never commits a preview', async t => {
  const h = harness(); t.after(h.session.dispose); await h.ready([item]);
  const task = h.session.design('move it', 'one', null);
  h.respond(1,{jobId:'job-one',status:'running',message:'Checking a preview…'});
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(h.requests[2].url, `/api/designer/job-one/?roomId=${ROOM.roomId}`);
  assert.deepEqual(h.state().snapshot?.instances,[item]);
  assert.equal(h.state().message,'Checking a preview…');
  h.respond(2,{jobId:'job-one',status:'failed',error:{code:'capture_unavailable',message:'Keep the room open.'}});
  assert.equal((await task).ok,false);
  assert.equal(h.state().status,'ready');
  assert.equal(h.state().canUndo,false);
});

test('reload resumes the server-owned active designer with its original request and undo base', async t => {
  const h = harness(); t.after(h.session.dispose);
  const task = h.session.load();
  const original = {text:'place a chair', requestId:'original-job',baseRevision:0,selectedId:null,camera:null};
  h.respond(0,{...payload(1,[item]),activeDesigner:{payload:original,before:[]}});
  await task;
  assert.equal(h.requests[1].url, `/api/designer/?roomId=${ROOM.roomId}`);
  assert.deepEqual(h.body(1),original);
  h.respond(1,{status:'completed',scene:payload(1,[item]),designer:{appliedCount:1,message:'Chair arranged.'}});
  await flush();
  assert.equal(h.state().canUndo,true);
});

test('shopping confirmation retries its operation and participates in undo history',async t=>{
  const h=harness();t.after(h.session.dispose);await h.ready();
  const task=h.session.confirm(item,3);
  assert.equal(h.requests[1].url,`/api/cart/confirm-placement/?roomId=${ROOM.roomId}`);
  const original=h.body(1);assert.equal(original.cartRevision,3);
  h.requests[1].reject(new Error('lost response'));assert.equal(await task,false);
  const retry=h.session.retry();assert.deepEqual(h.body(2),original);
  h.respond(2,{scene:payload(1,[item]),cart:{revision:4}});assert.equal(await retry,true);
  assert.equal(h.state().canUndo,true);
});

test('resumed designer receipt cannot replace a newer saved scene or add obsolete undo', async t => {
  const h = harness(); t.after(h.session.dispose);
  const load = h.session.load();
  const newer = {...item,pose:{...item.pose,xCm:300}};
  h.respond(0,{...payload(3,[newer]),activeDesigner:{
    payload:{text:'move chair',requestId:'original-job',baseRevision:1,selectedId:null,camera:null},before:[]}});
  await load;
  h.respond(1,{status:'completed',scene:payload(2,[item]),designer:{appliedCount:1,message:'Chair moved.'}});
  await flush();
  assert.equal(h.state().snapshot?.revision,3);
  assert.deepEqual(h.state().snapshot?.instances,[newer]);
  assert.equal(h.state().canUndo,false);
  assert.equal(h.state().status,'ready');
});

function harness() {
  let id = 0;
  const requests: { url: string; init: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const session = createRoomSession(ROOM.roomId, { csrf: () => "csrf-test", id: () => `edit-${++id}`,
    fetch: (url, init) => new Promise<Response>((resolve, reject) => requests.push({ url: String(url), init: init!, resolve, reject })),
  });
  const respond = (index: number, value: unknown, status = 200) => requests[index].resolve(Response.json(value, { status }));
  const ready = async (instances: Instance[] = []) => { const task = session.load(); respond(requests.length - 1, payload(0, instances)); await task; };
  return { session, requests, respond, ready, state: session.getSnapshot, body: (index: number) => JSON.parse(requests[index].init.body as string) };
}

test("room session parses actual prepared fixture and rejects conflicting geometry, products and floor data", () => {
  const scan = { ...payload(), room: { ...scanManifest.room, spatial }, geometryRevision: scanManifest.room.scan.geometryRevision };
  const copy = parseRoomSnapshot(scan, "studio-11");
  assert.equal(copy.room.scan?.calibration.status, "synthetic_demo");
  scan.room.scan.defaultCamera.xCm += 1;
  assert.notEqual(copy.room.scan?.defaultCamera.xCm, scan.room.scan.defaultCamera.xCm);
  scan.room.scan.defaultCamera.xCm -= 1;
  assert.throws(() => parseRoomSnapshot({ ...scan, geometryRevision: "different" }, "studio-11"));
  assert.throws(() => parseRoomSnapshot({ ...scan, products: [PRODUCTS[0], PRODUCTS[0]] }, "studio-11"));
  assert.throws(() => parseRoomSnapshot({ ...scan, products: [null] }, "studio-11"));
  assert.throws(() => parseRoomSnapshot({ ...scan, room: { ...scan.room, spatial: undefined } }, "studio-11"));
  assert.throws(() => parseRoomSnapshot({ ...scan, room: { ...scan.room, spatial: { ...spatial, freeAreas: [{ minXcm: 0, maxXcm: NaN, minZcm: 0, maxZcm: 10 }] } } }, "studio-11"));
  assert.throws(() => parseRoomSnapshot(payload(), "another-room"));
  for (const revision of [-1, 1.5, Infinity]) assert.throws(() => parseRoomSnapshot({ ...payload(), revision }, ROOM.roomId));
  assert.throws(() => parseRoomSnapshot(payload(1, [item, item]), ROOM.roomId));
});

test("server acceptance alone commits the layout and creates one undo entry", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const task = h.session.submit({ type: "add", instance: item });
  assert.equal(h.state().status, "saving");
  assert.deepEqual(h.state().snapshot?.instances, []);
  assert.equal(h.state().canUndo, false);
  assert.equal(await h.session.submit({ type: "remove", instanceId: "one" }), false);
  assert.equal(h.requests[1].url, `/api/scene/commands/?roomId=${ROOM.roomId}`);
  assert.equal((h.requests[1].init.headers as Record<string, string>)["X-CSRFToken"], "csrf-test");
  h.respond(1, payload(1, [item]));
  assert.equal(await task, true);
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  assert.equal(h.state().canUndo, true);
  assert.equal(h.state().canRedo, false);
});

test("definite placement rejection preserves layout and history; conflicting revisions require reload", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready([item]);
  const task = h.session.submit({ type: "setPose", instanceId: "one", pose: { ...item.pose, xCm: -1 } });
  h.respond(1, { error: { code: "placement", message: "Outside room" } }, 400);
  assert.equal(await task, false);
  assert.equal(h.state().status, "ready");
  assert.equal(h.state().message, "Outside room");
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  assert.equal(h.state().canUndo, false);
  const stale = h.session.submit({ type: "remove", instanceId: "one" });
  h.respond(2, { error: { code: "revision_conflict", message: "Room changed" } }, 409);
  assert.equal(await stale, false);
  assert.equal(h.state().status, "conflict");
  assert.equal(await h.session.submit({ type: "remove", instanceId: "one" }), false);
  await h.session.load();
  assert.equal(h.requests.length, 3);
  const reload = h.session.load(true);
  h.respond(3, payload(2, []));
  await reload;
  assert.equal(h.state().status, "ready");
  assert.deepEqual(h.state().snapshot?.instances, []);
});

test("lost response keeps an immutable command payload and retries its original id exactly once", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const edit: SceneEdit = { type: "add", instance: structuredClone(item) };
  const task = h.session.submit(edit);
  const sent = h.requests[1].init.body;
  edit.instance.pose.xCm = 999;
  h.requests[1].reject(new TypeError("Failed to fetch after server commit"));
  assert.equal(await task, false);
  assert.equal(h.state().status, "offline");
  assert.deepEqual(h.state().snapshot?.instances, []);
  await h.session.load(true);
  assert.equal(h.requests.length, 2, "reload cannot discard an uncertain committed request");
  const retry = h.session.retry();
  assert.equal(h.requests[2].init.body, sent);
  h.respond(2, payload(1, [item]));
  await retry;
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  const undo = h.session.undo();
  h.respond(3, payload(2, []));
  assert.equal(await undo, true);
  assert.equal(h.state().canUndo, false, "a retry does not duplicate the history entry");
  assert.equal(h.state().canRedo, true);
});

test("undo and redo leave committed poses unchanged until each server acknowledgement", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const add = h.session.submit({ type: "add", instance: item });
  h.respond(1, payload(1, [item])); await add;
  const moved = { ...item, pose: { ...item.pose, xCm: 300 } };
  const move = h.session.submit({ type: "setPose", instanceId: "one", pose: moved.pose });
  h.respond(2, payload(2, [moved])); await move;
  const undo = h.session.undo();
  assert.deepEqual(h.state().snapshot?.instances, [moved]);
  assert.equal(h.body(3).baseRevision, 2);
  assert.deepEqual(h.body(3).commands, [{ type: "remove", instanceId: "one" }, { type: "add", instance: item }]);
  h.respond(3, payload(3, [item])); await undo;
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  assert.equal(h.state().canRedo, true);
  const rejectedRedo = h.session.redo();
  h.respond(4, { error: { message: "Fixed obstacle" } }, 400); await rejectedRedo;
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  assert.equal(h.state().canRedo, true);
  const redo = h.session.redo();
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  h.respond(5, payload(4, [moved])); await redo;
  assert.deepEqual(h.state().snapshot?.instances, [moved]);
  assert.equal(h.state().canRedo, false);
});

test("polling pauses during interaction and an already pending newer response cannot replace the preview base", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready([item]);
  h.session.setActive(true);
  await h.session.load();
  assert.equal(h.requests.length, 1);
  h.session.setActive(false);
  const poll = h.session.load();
  h.session.setActive(true);
  h.respond(1, payload(1, [])); await poll;
  assert.equal(h.state().status, "conflict");
  assert.deepEqual(h.state().snapshot?.instances, [item]);
  assert.equal(await h.session.submit({ type: "remove", instanceId: "one" }), false);
});

test("unchanged in-flight poll neither replaces active state nor swallows a confirmed click", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready([item]);
  const original = h.state().snapshot;
  const poll = h.session.load();
  h.session.setActive(true);
  const remove = h.session.submit({ type: "remove", instanceId: "one" });
  assert.equal(h.requests.length, 2);
  h.respond(1, payload(0, [item])); await poll; await flush();
  assert.equal(h.state().snapshot, original);
  assert.equal(h.requests.length, 3);
  h.respond(2, payload(1, []));
  assert.equal(await remove, true);
});

test("a no-op acknowledgement does not create history because JSON key order changed", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready([item]);
  const task = h.session.submit({ type: "setPose", instanceId: "one", pose: item.pose });
  const reordered: Instance = { pose: { yawRad: item.pose.yawRad, zCm: item.pose.zCm, xCm: item.pose.xCm }, productId: item.productId, instanceId: item.instanceId };
  h.respond(1, payload(0, [reordered])); await task;
  assert.equal(h.state().canUndo, false);
});

test("retrying a failed background poll preserves accepted undo history", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const add = h.session.submit({ type: "add", instance: item });
  h.respond(1, payload(1, [item])); await add;
  const poll = h.session.load();
  h.requests[2].reject(new TypeError("Network unavailable")); await poll;
  assert.equal(h.state().status, "offline");
  const retry = h.session.retry();
  h.respond(3, payload(1, [item])); await retry;
  assert.equal(h.state().canUndo, true);
  const undo = h.session.undo();
  h.respond(4, payload(2, [])); await undo;
  assert.deepEqual(h.state().snapshot?.instances, []);
});

test("explicit retry during placement restores connectivity without replacing the preview base or history", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const add = h.session.submit({ type: "add", instance: item });
  h.respond(1, payload(1, [item])); await add;
  const moved = { ...item, pose: { ...item.pose, xCm: 300 } };
  const move = h.session.submit({ type: "setPose", instanceId: "one", pose: moved.pose });
  h.respond(2, payload(2, [moved])); await move;
  const undo = h.session.undo();
  h.respond(3, payload(3, [item])); await undo;
  const original = h.state().snapshot;
  const poll = h.session.load();
  h.session.setActive(true);
  h.requests[4].reject(new TypeError("Network unavailable")); await poll;
  assert.equal(h.state().status, "offline");
  await h.session.load();
  assert.equal(h.requests.length, 5, "ordinary polling remains paused during placement");
  const retry = h.session.retry();
  assert.equal(h.requests.length, 6, "explicit retry must issue a request during placement");
  h.respond(5, payload(3, [item])); await retry;
  assert.equal(h.state().status, "ready");
  assert.equal(h.state().snapshot, original, "keep the active preview's original snapshot");
  assert.equal(h.state().canUndo, true);
  assert.equal(h.state().canRedo, true);
  h.session.setActive(false);
  const redo = h.session.redo();
  assert.deepEqual(h.body(6).commands, [{ type: "remove", instanceId: "one" }, { type: "add", instance: moved }]);
  h.respond(6, payload(4, [moved])); await redo;
  assert.deepEqual(h.state().snapshot?.instances, [moved]);
});

test("explicit retry discovering a newer layout preserves the active preview and reports conflict", async t => {
  const h = harness(); t.after(h.session.dispose);
  await h.ready();
  const add = h.session.submit({ type: "add", instance: item });
  h.respond(1, payload(1, [item])); await add;
  const original = h.state().snapshot;
  const poll = h.session.load();
  h.session.setActive(true);
  h.requests[2].reject(new TypeError("Network unavailable")); await poll;
  const retry = h.session.retry();
  assert.equal(h.requests.length, 4);
  h.respond(3, payload(2, [])); await retry;
  assert.equal(h.state().status, "conflict");
  assert.equal(h.state().snapshot, original);
  assert.equal(h.state().canUndo, true);
  assert.equal(await h.session.submit({ type: "remove", instanceId: "one" }), false);
  const retryConflict = h.session.retry();
  h.respond(4, payload(2, [])); await retryConflict;
  assert.equal(h.state().status, "conflict");
  assert.equal(h.state().snapshot, original, "retry is not permission to discard the active preview");
});

test("dispose aborts a pending request and late responses cannot install state", async () => {
  const h = harness();
  const task = h.session.load();
  const state = h.state();
  h.session.dispose();
  assert.equal(h.requests[0].init.signal?.aborted, true);
  h.respond(0, payload(0, [item])); await task;
  assert.equal(h.state(), state);
});

test("catalogue snapshots retain canonical carried metadata and reject malformed or unlisted products", () => {
  const product = { ...PRODUCTS[0], productId: "catalogue-sofa", name: "Catalogue sofa" };
  const catalogueItem = { ...item, productId: product.productId, product: { ...product, widthCm: 1 } };
  const snapshot = { ...payload(1, [catalogueItem]), products: [...PRODUCTS, product] };
  const parsed = parseRoomSnapshot(snapshot, ROOM.roomId);
  assert.deepEqual(parsed.instances[0].product, product, "API product dimensions win over carried dimensions");
  product.widthCm += 10;
  assert.notEqual(parsed.instances[0].product?.widthCm, product.widthCm, "snapshot metadata is immutable");
  assert.throws(() => parseRoomSnapshot({ ...snapshot, products: PRODUCTS }, ROOM.roomId));
  for (const invalid of [null, { ...product, productId: "different" }, { ...product, widthCm: -1 }]) {
    assert.throws(() => parseRoomSnapshot({ ...snapshot, instances: [{ ...catalogueItem, product: invalid }] }, ROOM.roomId));
  }
});

test("catalogue remove and undo restore server-approved inline metadata", async t => {
  const h = harness(); t.after(h.session.dispose);
  const product = { ...PRODUCTS[0], productId: "catalogue-sofa", name: "Catalogue sofa" };
  const catalogueItem = { ...item, productId: product.productId, product };
  const snapshot = (revision: number, instances: Instance[]) => ({ ...payload(revision, instances), products: [...PRODUCTS, product] });
  const load = h.session.load();
  h.respond(0, snapshot(0, [catalogueItem])); await load;
  const remove = h.session.submit({ type: "remove", instanceId: item.instanceId });
  h.respond(1, snapshot(1, [])); assert.equal(await remove, true);
  const undo = h.session.undo();
  assert.deepEqual(h.body(2).commands, [{ type: "add", instance: catalogueItem }]);
  h.respond(2, snapshot(2, [catalogueItem])); assert.equal(await undo, true);
  assert.deepEqual(h.state().snapshot?.instances, [catalogueItem]);
});


test('attachment history removes children first, restores parents first, and keeps elevated poses',async t=>{
  const h=harness();t.after(h.session.dispose);
  const parent:Instance={instanceId:'table',productId:'support-demo-table',pose:{xCm:200,zCm:200,yawRad:0}};
  const child:Instance={instanceId:'lamp',productId:'support-demo-lamp',pose:{xCm:200,zCm:200,yawRad:0,yCm:75},
    attachment:{parentInstanceId:'table',profileRevision:'1',target:{kind:'surface',id:'top'},localPose:{xCm:0,zCm:0,yawRad:0}}};
  await h.ready([parent]);
  const add=h.session.submit({type:'add',instance:child});h.respond(1,payload(1,[parent,child]));await add;
  const undo=h.session.undo();
  assert.deepEqual(h.body(2).commands.map((c:SceneEdit)=>c.type==='add'?c.instance.instanceId:c.instanceId),['lamp','table','table']);
  h.respond(2,payload(2,[parent]));await undo;
  const redo=h.session.redo();
  assert.deepEqual(h.body(3).commands.map((c:SceneEdit)=>c.type==='add'?c.instance.instanceId:c.instanceId),['table','table','lamp']);
  h.respond(3,payload(3,[parent,child]));await redo;
  assert.deepEqual(h.state().snapshot?.instances[1],child);
});
