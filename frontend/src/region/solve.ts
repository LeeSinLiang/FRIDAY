// The region solver's entry point. Pure.
// Program.place (mm) + scene (cm) + candidate -> one floor-grid-v1 mask per quarter turn.

import type { PlaceClause } from "../lib/dsl/schema";
import { placeToCm } from "./boundary";
import { doorSwingRule, resolveClause, wallClearances, type Dropped, type Rule } from "./clauses";
import { explainNothingFits } from "./explain";
import { floorRegion } from "./floor";
import { countFree, fillMask, footprintRect, intersect, newMask } from "./grid";
import { invariantMask, type Candidate } from "./invariants";
import { BLOCKED, FREE, YAW_BINS, type Mask, type Scene } from "./types";

export type Solution = {
  /** One mask per rotation, in YAW_BINS order: 0, 90, 180, 270 degrees. */
  masks: Mask[];
  /** Clauses that could not be honoured, with the reason. Show these; never discard meaning silently. */
  dropped: Dropped[];
  /** Legal centres per rotation, and the rotation with the most. -1 when nothing fits anywhere. */
  legalCounts: number[];
  bestYawIndex: number;
  /** Only when nothing fits: the binding constraint in plain words, e.g. "needs 386 cm of depth, this room has 360 cm". */
  whyNothingFits?: string;
};

function ruleMask(scene: Scene, candidate: Candidate, yawRad: number, rules: Rule[]): Mask {
  return fillMask(newMask(scene.room, yawRad), (xCm, zCm) => {
    const pose = { xCm, zCm, yawRad };
    const footprint = footprintRect(candidate.product, pose);
    return rules.every((rule) => rule(pose, footprint)) ? FREE : BLOCKED;
  });
}

/** Where may this item go? Invariants always apply; clauses narrow; unknown floor never lights. */
export function solve(scene: Scene, candidate: Candidate, place: PlaceClause[]): Solution {
  const { masks, dropped, legalCounts } = solveOnce(scene, candidate, place);
  const most = Math.max(...legalCounts);
  if (most > 0) return { masks, dropped, legalCounts, bestYawIndex: legalCounts.indexOf(most) };
  const whyNothingFits = explainNothingFits(scene.room, candidate.product, place, (fewer) => solveOnce(scene, candidate, fewer));
  return { masks, dropped, legalCounts, bestYawIndex: -1, whyNothingFits };
}

function solveOnce(scene: Scene, candidate: Candidate, place: PlaceClause[]): Pick<Solution, "masks" | "dropped" | "legalCounts"> {
  const rules: Rule[] = [doorSwingRule(scene)], dropped: Dropped[] = [], ignore = [...(candidate.ignoreInstanceIds ?? [])];
  const clauses = placeToCm(place), clearances = wallClearances(clauses);
  const region = floorRegion(scene.room); // once per solve, not once per clause or per grid point
  for (const clause of clauses) {
    const resolved = resolveClause(scene, candidate.product, clause, clearances, region);
    if ("dropped" in resolved) { dropped.push({ clause, reason: resolved.dropped }); continue; }
    rules.push(resolved.rule);
    if (resolved.ignoreInstanceId) ignore.push(resolved.ignoreInstanceId);
  }
  const withIgnores = { ...candidate, ignoreInstanceIds: ignore };
  const masks = YAW_BINS.map((yawRad) => intersect(invariantMask(scene, withIgnores, yawRad), ruleMask(scene, candidate, yawRad, rules)));
  return { masks, dropped, legalCounts: masks.map(countFree) };
}
