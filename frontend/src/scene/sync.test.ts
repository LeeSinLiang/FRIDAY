import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCTS, ROOM } from "./fixtures";
import { createSceneSyncController, parseSceneSnapshot, sceneFingerprint, type SyncStatus } from "./useSceneSync";
import type { Instance } from "./types";

const instance = { instanceId: "one", productId: PRODUCTS[0].productId, pose: { xCm: 150, zCm: 200, yawRad: 0 } };
const payload = () => ({ room: ROOM, products: PRODUCTS, instances: [structuredClone(instance)], revision: 3 });

test("scene sync accepts a persisted canonical snapshot without retaining unknown fields", () => {
  const value = payload();
  const result = parseSceneSnapshot(value);
  assert.deepEqual(result, { revision: 3, instances: [instance] });
  value.instances[0].pose.xCm = 900;
  assert.equal(result.instances[0].pose.xCm, 150);
});

test("scene sync rejects unsafe revisions, duplicate IDs, unknown products, and nonfinite poses", () => {
  for (const revision of [-1, 1.5, Infinity, "3", Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => parseSceneSnapshot({ ...payload(), revision }));
  assert.throws(() => parseSceneSnapshot({ ...payload(), instances: [instance, instance] }));
  assert.throws(() => parseSceneSnapshot({ ...payload(), instances: [{ ...instance, productId: "unexpected" }] }));
  for (const xCm of [NaN, Infinity, "10", null])
    assert.throws(() => parseSceneSnapshot({ ...payload(), instances: [{ ...instance, pose: { ...instance.pose, xCm } }] }));
  assert.throws(() => parseSceneSnapshot({ ...payload(), instances: Array.from({ length: 101 }, (_, i) => ({ ...instance, instanceId: String(i) })) }));
});

test("scene sync does not install a server snapshot for another room or missing catalogue", () => {
  assert.throws(() => parseSceneSnapshot({ ...payload(), room: { ...ROOM, widthCm: ROOM.widthCm + 1 } }));
  assert.throws(() => parseSceneSnapshot({ ...payload(), products: [] }));
  assert.throws(() => parseSceneSnapshot(null));
});

test("scene fingerprint ignores property order and distinguishes physical pose changes", () => {
  const reordered = { pose: { yawRad: 0, zCm: 200, xCm: 150 }, productId: PRODUCTS[0].productId, instanceId: "one" };
  assert.equal(sceneFingerprint([instance]), sceneFingerprint([reordered]));
  assert.notEqual(sceneFingerprint([instance]), sceneFingerprint([{ ...instance, pose: { ...instance.pose, xCm: 155 } }]));
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness() {
  const requests: { init: RequestInit; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
  const replacements: Instance[][] = [];
  const latest = { current: { instances: [] as Instance[], interactionActive: false, replace: (instances: Instance[]) => replacements.push(instances) } };
  let state = { ready: false, status: "loading" as SyncStatus, message: "", revision: null as number | null };
  const controller = createSceneSyncController(latest, (next) => { state = next; }, {
    csrfToken: () => "test-csrf-token",
    fetch: (_url, init) => new Promise<Response>((resolve, reject) => requests.push({ init: init!, resolve, reject })),
  });
  const respond = (index: number, revision: number, xCm = 150) => {
    requests[index].resolve(Response.json({ ...payload(), revision, instances: [{ ...instance, pose: { ...instance.pose, xCm } }] }));
  };
  const edit = (xCm: number) => {
    latest.current = { ...latest.current, instances: [{ ...instance, pose: { ...instance.pose, xCm } }] };
    controller.reconcile();
  };
  return { controller, latest, requests, replacements, respond, edit, state: () => state };
}

test("sync serializes saves and advances revisions while newer edits remain local", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  assert.equal(h.state().ready, false);
  h.respond(0, 3);
  await flush();
  assert.equal(h.state().status, "saved");
  h.edit(155);
  t.mock.timers.tick(399);
  assert.equal(h.requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].init.credentials, "same-origin");
  assert.equal((h.requests[1].init.headers as Record<string, string>)["X-CSRFToken"], "test-csrf-token");
  assert.equal(JSON.parse(h.requests[1].init.body as string).baseRevision, 3);
  h.edit(160);
  t.mock.timers.tick(800);
  assert.equal(h.requests.length, 2, "never issue overlapping PUTs");
  h.respond(1, 4, 155);
  await flush();
  assert.equal(h.latest.current.instances[0].pose.xCm, 160);
  assert.equal(h.replacements.length, 1, "autosave acknowledgement preserves undo history");
  t.mock.timers.tick(400);
  assert.equal(JSON.parse(h.requests[2].init.body as string).baseRevision, 4);
  h.respond(2, 5, 160);
  await flush();
  assert.equal(h.state().status, "saved");
  assert.equal(h.state().revision, 5);
});

test("sync cannot overwrite edits created during a clean poll; reload explicitly resolves conflict", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  h.respond(0, 3);
  await flush();
  t.mock.timers.tick(2000);
  assert.equal(h.requests[1].init.method, "GET");
  h.edit(155);
  h.respond(1, 4, 200);
  await flush();
  assert.equal(h.state().status, "conflict");
  assert.equal(h.latest.current.instances[0].pose.xCm, 155);
  assert.equal(h.replacements.length, 1);
  h.controller.retry();
  t.mock.timers.tick(5000);
  assert.equal(h.requests.length, 2);
  h.controller.reload();
  assert.equal(h.state().ready, false);
  h.respond(2, 4, 200);
  await flush();
  assert.equal(h.state().status, "saved");
  assert.equal(h.latest.current.instances[0].pose.xCm, 200);
});

test("sync pauses writes during dragging and retains dirty data through network retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  h.respond(0, 3);
  await flush();
  h.latest.current.interactionActive = true;
  h.edit(155);
  t.mock.timers.tick(2400);
  assert.equal(h.requests.length, 1);
  h.latest.current.interactionActive = false;
  h.controller.reconcile();
  t.mock.timers.tick(400);
  h.requests[1].reject(new TypeError("Failed to fetch"));
  await flush();
  assert.equal(h.state().status, "offline");
  assert.equal(h.state().ready, true);
  assert.equal(h.latest.current.instances[0].pose.xCm, 155);
  h.controller.retry();
  t.mock.timers.tick(400);
  h.respond(2, 4, 155);
  await flush();
  assert.equal(h.state().status, "saved");
});

test("HTTP409 never retries stale writes automatically", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  h.respond(0, 3);
  await flush();
  h.edit(155);
  t.mock.timers.tick(400);
  h.requests[1].resolve(new Response("", { status: 409 }));
  await flush();
  assert.equal(h.state().status, "conflict");
  assert.equal(h.latest.current.instances[0].pose.xCm, 155);
  h.controller.retry();
  t.mock.timers.tick(10000);
  assert.equal(h.requests.length, 2);
});

test("disposed StrictMode lifetime cannot apply a late initial response", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  const initial = h.state();
  h.controller.dispose();
  assert.equal(h.requests[0].init.signal?.aborted, true);
  h.respond(0, 3);
  await flush();
  assert.deepEqual(h.state(), initial);
  assert.equal(h.replacements.length, 0);
  t.mock.timers.tick(10000);
  assert.equal(h.requests.length, 1);
});

test("initial load failure keeps editing gated until a successful retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  h.requests[0].reject(new TypeError("Failed to fetch"));
  await flush();
  assert.equal(h.state().ready, false);
  assert.equal(h.state().status, "offline");
  h.controller.retry();
  h.respond(1, 3);
  await flush();
  assert.equal(h.state().ready, true);
  assert.equal(h.state().status, "saved");
});

test("an unchanged poll response does not erase edits made while it was pending", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const h = harness();
  t.after(() => h.controller.dispose());
  h.respond(0, 3);
  await flush();
  t.mock.timers.tick(2000);
  h.edit(155);
  h.respond(1, 3);
  await flush();
  assert.equal(h.state().status, "unsaved");
  assert.equal(h.latest.current.instances[0].pose.xCm, 155);
  t.mock.timers.tick(400);
  assert.equal(h.requests[2].init.method, "PUT");
  h.respond(2, 4, 155);
  await flush();
  assert.equal(h.state().status, "saved");
});
