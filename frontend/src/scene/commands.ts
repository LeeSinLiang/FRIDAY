import { validInlineProduct } from "./products";
import type { Instance, Pose, Product, SceneEdit } from "./types";

export type EditorHistory = {
  past: Instance[][];
  present: Instance[];
  future: Instance[][];
};
export const initialHistory = (): EditorHistory => ({
  past: [],
  present: [],
  future: [],
});
export const validPose = (pose: Pose) =>
  !!pose && [pose.xCm, pose.zCm, pose.yawRad].every(Number.isFinite);
const samePose = (a: Pose, b: Pose) =>
  a.xCm === b.xCm && a.zCm === b.zCm && a.yawRad === b.yawRad;
const validProduct = (product: Product) =>
  [product.widthCm, product.depthCm, product.heightCm].every(
    (n) => Number.isFinite(n) && n > 0,
  );

/** Invalid edits preserve identity, so they neither render nor consume undo history. */
export function applyEdit(
  instances: Instance[],
  command: SceneEdit,
  products: Product[],
): Instance[] {
  if (!command || typeof command !== "object") return instances;
  if (command.type === "add") {
    const item = command.instance;
    if (
      !item ||
      typeof item.instanceId !== "string" ||
      !item.instanceId.trim() ||
      !validPose(item.pose)
    )
      return instances;
    if (instances.some((i) => i.instanceId === item.instanceId))
      return instances;
    const shared = products.some((p) => p.productId === item.productId && validProduct(p));
    // A shared product always wins; an inline one is only consulted for ids the shared list lacks.
    if (!shared && !validInlineProduct(item.product, item.productId)) return instances;
    const { product, ...rest } = item;
    return [...instances, { ...rest, pose: { ...item.pose }, ...(shared || !product ? {} : { product: { ...product } }) }];
  }
  const index = instances.findIndex((i) => i.instanceId === command.instanceId);
  if (index < 0) return instances;
  if (command.type === "remove") return instances.filter((_, i) => i !== index);
  if (
    command.type === "setPose" &&
    validPose(command.pose) &&
    !samePose(instances[index].pose, command.pose)
  ) {
    return instances.map((item, i) =>
      i === index ? { ...item, pose: { ...command.pose } } : item,
    );
  }
  return instances;
}

export function historyReducer(
  state: EditorHistory,
  action: SceneEdit | { type: "undo" | "redo" },
  products: Product[],
): EditorHistory {
  if (!action || typeof action !== "object") return state;
  if (action.type === "undo") {
    if (!state.past.length) return state;
    return {
      past: state.past.slice(0, -1),
      present: state.past[state.past.length - 1],
      future: [state.present, ...state.future],
    };
  }
  if (action.type === "redo") {
    if (!state.future.length) return state;
    return {
      past: [...state.past, state.present],
      present: state.future[0],
      future: state.future.slice(1),
    };
  }
  const next = applyEdit(state.present, action as SceneEdit, products);
  return next === state.present
    ? state
    : {
        past: [...state.past, state.present].slice(-100),
        present: next,
        future: [],
      };
}
