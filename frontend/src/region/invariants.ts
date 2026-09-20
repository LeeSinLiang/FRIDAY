// The rules that are never clauses: inside the room, not overlapping anything, not too tall,
// not on a static obstacle or unobserved floor. Pure.
//
// Bounds, height and overlap are NOT reimplemented here. The scene's validatePlacement is asked
// directly for every grid point, so the lit floor and the editor's drop check cannot disagree.

import { validatePlacement } from "../scene/placement";
import type { Instance, Product } from "../scene/types";
import { fillMask, footprintRect, newMask } from "./grid";
import { indexOccupancy, occupancyState } from "./occupancy";
import { BLOCKED, FREE, type Mask, type Scene } from "./types";

export type Candidate = {
  product: Product;
  /** Set when an item already in the scene is being moved; it must not collide with itself. */
  movingInstanceId?: string;
  /** Explicit exclusions for callers with a separate collision contract; tabletop support uses the validator directly. */
  ignoreInstanceIds?: string[];
};

function candidateId(instances: Instance[]): string {
  let id = "__region_candidate__";
  while (instances.some((instance) => instance.instanceId === id)) id += "_";
  return id;
}

/** Where the candidate may be centred at this rotation, before any place clause. */
export function invariantMask(scene: Scene, candidate: Candidate, yawRad: number): Mask {
  const { product, movingInstanceId, ignoreInstanceIds = [] } = candidate;
  const products = scene.products.some((p) => p.productId === product.productId) ? scene.products : [...scene.products, product];
  const others = scene.instances.filter((i) => i.instanceId !== movingInstanceId && !ignoreInstanceIds.includes(i.instanceId));
  const id = movingInstanceId ?? candidateId(others);
  const occupancy = scene.occupancy ? indexOccupancy(scene.occupancy) : null;

  // validatePlacement takes the candidate's pose as an argument and only uses the list for the
  // others, so one list serves all 12,000 points.
  const instances = [...others, { instanceId: id, productId: product.productId, pose: { xCm: 0, zCm: 0, yawRad } }];

  return fillMask(newMask(scene.room, yawRad), (xCm, zCm) => {
    const pose = { xCm, zCm, yawRad };
    if (!validatePlacement(scene.room, products, instances, id, pose).valid) return BLOCKED;
    return occupancy ? occupancyState(occupancy, footprintRect(product, pose)) : FREE;
  });
}
