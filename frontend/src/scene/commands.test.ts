import assert from "node:assert/strict";
import test from "node:test";
import { applyEdit, historyReducer, initialHistory } from "./commands";
import {
  cmToScene,
  sceneToCm,
  meterGlbToSceneScale,
  validateScale,
} from "./units";
import type { Instance, Product, SceneEdit } from "./types";

const products: Product[] = [
  {
    productId: "sofa",
    name: "Sofa",
    widthCm: 200,
    depthCm: 90,
    heightCm: 80,
    color: "#ccc",
    kind: "sofa",
  },
];
const instance: Instance = {
  instanceId: "one",
  productId: "sofa",
  pose: { xCm: 100, zCm: 150, yawRad: 0 },
};

test("physical dimensions stay constant at 5 and 10 cm/unit, including meter GLBs", () => {
  for (const scale of [5, 10]) {
    assert.deepEqual(
      [600, 500, 280].map((n) => cmToScene(n, scale)),
      [600 / scale, 500 / scale, 280 / scale],
    );
    assert.equal(sceneToCm(cmToScene(243, scale), scale), 243);
    assert.equal(2 * meterGlbToSceneScale(scale), cmToScene(200, scale));
  }
  for (const value of [0, -5, NaN, Infinity, "", "bad", null])
    assert.throws(() => validateScale(value));
});

test("add, move, rotate, remove undo and redo preserve exact cm snapshots", () => {
  let history = initialHistory();
  const actions: SceneEdit[] = [
    { type: "add", instance },
    {
      type: "setPose",
      instanceId: "one",
      pose: { xCm: 200, zCm: 250, yawRad: 0 },
    },
    {
      type: "setPose",
      instanceId: "one",
      pose: { xCm: 200, zCm: 250, yawRad: Math.PI / 2 },
    },
    { type: "remove", instanceId: "one" },
  ];
  const snapshots = [history.present];
  for (const action of actions) {
    history = historyReducer(history, action, products);
    snapshots.push(history.present);
  }
  assert.equal(history.past.length, 4);
  for (let index = 3; index >= 0; index--) {
    history = historyReducer(history, { type: "undo" }, products);
    assert.deepEqual(history.present, snapshots[index]);
  }
  for (let index = 1; index <= 4; index++) {
    history = historyReducer(history, { type: "redo" }, products);
    assert.deepEqual(history.present, snapshots[index]);
  }
});

test("invalid and no-op commands preserve identity and history; divergent edits clear redo", () => {
  const history = historyReducer(
    initialHistory(),
    { type: "add", instance },
    products,
  );
  const invalid: SceneEdit[] = [
    { type: "add", instance },
    {
      type: "add",
      instance: { ...instance, instanceId: "two", productId: "missing" },
    },
    {
      type: "add",
      instance: { ...instance, instanceId: "", pose: { ...instance.pose } },
    },
    {
      type: "setPose",
      instanceId: "one",
      pose: { ...instance.pose, xCm: NaN },
    },
    {
      type: "setPose",
      instanceId: "one",
      pose: { ...instance.pose, yawRad: Infinity },
    },
    { type: "setPose", instanceId: "missing", pose: instance.pose },
    { type: "setPose", instanceId: "one", pose: instance.pose },
    { type: "remove", instanceId: "missing" },
  ];
  for (const edit of invalid)
    assert.equal(historyReducer(history, edit, products), history);
  assert.deepEqual(
    applyEdit([], { type: "add", instance }, [{ ...products[0], widthCm: 0 }]),
    [],
  );
  const removed = historyReducer(
    history,
    { type: "remove", instanceId: "one" },
    products,
  );
  const undone = historyReducer(removed, { type: "undo" }, products);
  const moved = historyReducer(
    undone,
    {
      type: "setPose",
      instanceId: "one",
      pose: { ...instance.pose, xCm: 101 },
    },
    products,
  );
  assert.equal(moved.future.length, 0);
  assert.equal(moved.past.length, 2);
});

test("command inputs cannot mutate saved history afterward", () => {
  const input = { ...instance, pose: { ...instance.pose } };
  const added = historyReducer(
    initialHistory(),
    { type: "add", instance: input },
    products,
  );
  input.pose.xCm = 999;
  assert.equal(added.present[0].pose.xCm, 100);
});

test("malformed runtime commands preserve history", () => {
  const history = initialHistory();
  for (const command of [
    null,
    undefined,
    false,
    4,
    {},
    { type: "unknown" },
    { type: "add", instance: null },
  ]) {
    assert.equal(
      historyReducer(history, command as SceneEdit, products),
      history,
    );
  }
});
