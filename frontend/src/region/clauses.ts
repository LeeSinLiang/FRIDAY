// One mask rule per place[] clause. Pure.
//
// any_wall, and a door or window named without an id, mean different things by clause kind:
//   distance_min, clear, not_blocking -> EVERY target must satisfy it (masks intersect)
//   near, against, on                 -> SOME ONE target is enough    (masks union)
// This matches how compile() emits them; see docs/backend/catalogue.md.

import type { Pose, Product } from "../scene/types";
import { WALL_SIDES, WALL_SIDE_BY_ID, wallRect, type PlaceCm } from "./boundary";
import { EPSILON_CM, gap, openingZone, overlapsArea } from "./geometry";
import { footprintRect } from "./grid";
import type { Opening, Rect, Scene, WallSide } from "./types";

// Tunables. Judgement calls, not data: adjust at rehearsal.
/** "By the window" with no distance given. */
export const NEAR_DEFAULT_CM = 75;
/** Items rarely land flush on a 5 cm grid, so "against" allows this much gap. */
export const AGAINST_TOLERANCE_CM = 5;
/** ASSUMPTION: the room carries no sill height. Items no taller than this never block a window. */
export const WINDOW_SILL_CM = 90;
/** How far in front of a window counts as blocking it. */
export const WINDOW_ZONE_CM = 50;
/** Room to walk up to a piece of furniture, for not_blocking(instance). */
export const APPROACH_CM = 60;
/** One line to enable if the editor ever accepts an item overlapping its support. Until then a lit
 *  region on a table top would be refused on drop, which is worse than no region. */
export const ALLOW_STACKING = false;

/** The clearance each wall demands, from every distance_min and clear clause naming it or any_wall. */
export function wallClearances(place: PlaceCm[]): Record<WallSide, number> {
  const need: Record<WallSide, number> = { n: 0, e: 0, s: 0, w: 0 };
  for (const clause of place) {
    if ((clause.k !== "distance_min" && clause.k !== "clear") || clause.cm === undefined) continue;
    const sides = clause.ref.kind === "any_wall" ? WALL_SIDES : clause.ref.kind === "wall" ? [WALL_SIDE_BY_ID[clause.ref.id]] : [];
    for (const side of sides) if (side) need[side] = Math.max(need[side], clause.cm);
  }
  return need;
}

export type Dropped = { clause: PlaceCm; reason: string };

type Target = { rect: Rect; wall?: WallSide; opening?: Opening; instanceId?: string };
export type Rule = (pose: Pose, footprint: Rect) => boolean;
export type Resolved = { rule: Rule; ignoreInstanceId?: string } | { dropped: string };

const EVERY_KINDS = new Set<PlaceCm["k"]>(["distance_min", "clear", "not_blocking"]);

// Front faces +Z at yaw 0 and +pi/2 turns it toward +X, so this is the yaw with the item's BACK to each wall.
const YAW_BACK_TO_WALL: Record<WallSide, number> = { n: 0, w: Math.PI / 2, s: Math.PI, e: (3 * Math.PI) / 2 };
const sameYaw = (a: number, b: number) => Math.abs(Math.sin((a - b) / 2)) < 1e-6;

function targets(scene: Scene, clause: PlaceCm): Target[] | string {
  const ref = clause.ref;
  if (ref.kind === "any_wall") return WALL_SIDES.map((wall) => ({ rect: wallRect(scene.room, wall), wall }));
  if (ref.kind === "wall") {
    const wall = WALL_SIDE_BY_ID[ref.id];
    return wall ? [{ rect: wallRect(scene.room, wall), wall }] : `the room has no wall "${ref.id}"`;
  }
  if (ref.kind === "instance") {
    const instance = scene.instances.find((i) => i.instanceId === ref.id);
    const product = instance && scene.products.find((p) => p.productId === instance.productId);
    return instance && product ? [{ rect: footprintRect(product, instance.pose), instanceId: instance.instanceId }]
      : `nothing called "${ref.id}" is in the room`;
  }
  const openings = (scene.openings ?? []).filter((o) => o.kind === ref.kind && (ref.id === undefined || o.id === ref.id));
  if (!scene.openings?.length) return `the room does not describe its ${ref.kind}s yet`;
  if (!openings.length) return ref.id ? `the room has no ${ref.kind} "${ref.id}"` : `the room has no ${ref.kind}`;
  return openings.map((opening) => ({ rect: openingZone(scene.room, opening, 0), wall: opening.wall, opening }));
}

function ruleFor(scene: Scene, product: Product, clause: PlaceCm, target: Target, clearances: Record<WallSide, number>): Rule | string {
  const { k, cm } = clause;
  const zone = (depthCm: number) => openingZone(scene.room, target.opening!, depthCm);

  if (k === "distance_min") return (_, footprint) => gap(footprint, target.rect) >= cm! - EPSILON_CM;
  if (k === "near") {
    // "By the window, 5 feet from any wall": the window is ON a wall, so a fixed reach shorter than
    // that wall's clearance makes the sentence contradict itself in every room. When no distance is
    // stated, "near" means as near as the other requests allow: the default reach starts where the
    // target's own wall lets the item stand. A stated distance is taken literally.
    const reach = cm ?? NEAR_DEFAULT_CM + (target.wall ? clearances[target.wall] : 0);
    return (_, footprint) => gap(footprint, target.rect) <= reach + EPSILON_CM;
  }
  if (k === "clear") return target.opening
    ? (_, footprint) => !overlapsArea(footprint, zone(cm!))
    : (_, footprint) => gap(footprint, target.rect) >= cm! - EPSILON_CM;
  if (k === "against" || (k === "on" && target.wall && !target.opening)) {
    // "On the wall" (a shelf, a mirror) is floor-wise the same as against it.
    const wall = target.wall;
    return (pose, footprint) => gap(footprint, target.rect) <= AGAINST_TOLERANCE_CM + EPSILON_CM
      && (wall === undefined || sameYaw(pose.yawRad, YAW_BACK_TO_WALL[wall]));
  }
  if (k === "not_blocking") {
    if (target.opening?.kind === "door") return (_, footprint) => !overlapsArea(footprint, zone(target.opening!.swingCm ?? target.opening!.widthCm));
    // A measured sill wins over the assumption: floor-to-ceiling glazing is blocked by anything in front of it.
    if (target.opening) return product.heightCm <= (target.opening.sillCm ?? WINDOW_SILL_CM) + EPSILON_CM
      ? () => true : (_, footprint) => !overlapsArea(footprint, zone(WINDOW_ZONE_CM));
    if (target.instanceId) return (_, footprint) => gap(footprint, target.rect) >= APPROACH_CM - EPSILON_CM;
    return "a wall cannot be blocked";
  }
  if (k === "on" && target.instanceId) {
    if (!ALLOW_STACKING) return "the editor cannot place one item on another yet, so this would light floor the drop then refuses";
    const support = target.rect;
    return (pose) => pose.xCm >= support.minX && pose.xCm <= support.maxX && pose.zCm >= support.minZ && pose.zCm <= support.maxZ;
  }
  return `"${k}" does not apply to a ${clause.ref.kind}`;
}

/** Turn one clause into a rule over poses, or say why it cannot be honoured. Never throws. */
export function resolveClause(scene: Scene, product: Product, clause: PlaceCm,
                              clearances: Record<WallSide, number> = { n: 0, e: 0, s: 0, w: 0 }): Resolved {
  if ((clause.k === "distance_min" || clause.k === "clear") && clause.cm === undefined) return { dropped: "no distance was given" };
  const found = targets(scene, clause);
  if (typeof found === "string") return { dropped: found };
  const rules: Rule[] = [];
  for (const target of found) {
    const rule = ruleFor(scene, product, clause, target, clearances);
    if (typeof rule === "string") return { dropped: rule };
    rules.push(rule);
  }
  const every = EVERY_KINDS.has(clause.k);
  const rule: Rule = (pose, footprint) => every ? rules.every((r) => r(pose, footprint)) : rules.some((r) => r(pose, footprint));
  const stackedOn = clause.k === "on" && clause.ref.kind === "instance" ? clause.ref.id : undefined;
  return { rule, ...(stackedOn ? { ignoreInstanceId: stackedOn } : {}) };
}

/** Never a clause, always applied: nothing may stand in a door's swing. */
export function doorSwingRule(scene: Scene): Rule {
  const zones = (scene.openings ?? []).filter((o) => o.kind === "door").map((o) => openingZone(scene.room, o, o.swingCm ?? o.widthCm));
  return (_, footprint) => zones.every((zone) => !overlapsArea(footprint, zone));
}
