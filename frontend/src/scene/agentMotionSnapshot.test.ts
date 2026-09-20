import assert from "node:assert/strict";
import test from "node:test";
import { PRODUCTS, ROOM } from "./fixtures";
import type { Instance } from "./types";
import { createRoomSession, parseRoomSnapshot } from "./useRoomSession";

const item: Instance = {
  instanceId: "angel-sofa", productId: PRODUCTS[0].productId,
  pose: { xCm: 200, zCm: 200, yawRad: 0 },
};
const event = () => ({ revision: 1, instanceId: item.instanceId,
  fromPose: { xCm: 170, zCm: 200, yawRad: 0 }, toPose: { ...item.pose } });
const snapshot = () => ({ room: ROOM, products: PRODUCTS, instances: [structuredClone(item)],
  revision: 1, geometryRevision: String(ROOM.revision), agentMotion: event() });

test("agent motion metadata survives snapshot parsing without retaining mutable response references", () => {
  const response = snapshot();
  const parsed = parseRoomSnapshot(response, ROOM.roomId);
  assert.deepEqual(parsed.agentMotion, response.agentMotion);
  response.agentMotion.fromPose.xCm = 999;
  response.agentMotion.toPose.xCm = 999;
  assert.equal(parsed.agentMotion?.fromPose?.xCm, 170);
  assert.equal(parsed.agentMotion?.toPose.xCm, 200);
  assert.deepEqual(parsed.instances, [item]);
});

test("new furniture can carry a null source pose and repeated polls preserve its event identity", () => {
  const response = { ...snapshot(), agentMotion: { ...event(), fromPose: null } };
  const initial = parseRoomSnapshot(response, ROOM.roomId);
  const polled = parseRoomSnapshot(structuredClone(response), ROOM.roomId);
  assert.equal(initial.agentMotion?.fromPose, null);
  assert.deepEqual(polled.agentMotion, initial.agentMotion);
  assert.equal(polled.agentMotion?.revision, initial.revision);
});

test("invalid optional motion metadata never invalidates the accepted furniture layout", () => {
  const invalidEvents = [
    { ...event(), revision: 0 },
    { ...event(), revision: 2 },
    { ...event(), instanceId: "missing-furniture" },
    { ...event(), toPose: { ...item.pose, xCm: NaN } },
    { ...event(), toPose: null },
    { ...event(), fromPose: { xCm: 100, zCm: 200 } },
    { ...event(), fromPose: { ...item.pose, yawRad: Infinity } },
  ];
  for (const agentMotion of invalidEvents) {
    const parsed = parseRoomSnapshot({ ...snapshot(), agentMotion }, ROOM.roomId);
    assert.equal(parsed.agentMotion, undefined);
    assert.equal(parsed.revision, 1);
    assert.deepEqual(parsed.instances, [item]);
  }
});

test("a manual edit acknowledgment clears the prior agent move instead of carrying it into the new revision", async t => {
  const moved = { ...item, pose: { ...item.pose, xCm: 240 } };
  const responses: unknown[] = [snapshot(), {
    room: ROOM, products: PRODUCTS, instances: [moved], revision: 2,
    geometryRevision: String(ROOM.revision),
  }];
  const session = createRoomSession(ROOM.roomId, {
    csrf: () => "test-csrf", id: () => "manual-edit",
    fetch: async () => Response.json(responses.shift()),
  });
  t.after(() => session.dispose());
  await session.load();
  assert.equal(session.getSnapshot().snapshot?.agentMotion?.revision, 1);
  assert.equal(await session.submit({ type: "setPose", instanceId: item.instanceId, pose: moved.pose }), true);
  assert.equal(session.getSnapshot().snapshot?.agentMotion, undefined);
  assert.equal(session.getSnapshot().snapshot?.revision, 2);
  assert.deepEqual(session.getSnapshot().snapshot?.instances, [moved]);
  assert.equal(session.getSnapshot().canUndo, true);
});
