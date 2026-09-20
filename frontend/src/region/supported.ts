import type { PlaceClause } from "../lib/dsl/schema";
import { attachAt, localToWorld, supportForRef, worldToLocal } from "../scene/supports";
import { validatePlacement } from "../scene/placement";
import { placeToCm } from "./boundary";
import { doorSwingRule, resolveClause, wallClearances, type Dropped, type Rule } from "./clauses";
import { fillMask, footprintRect, countFree, newMask } from "./grid";
import type { Candidate } from "./invariants";
import type { Solution } from "./solve";
import { BLOCKED, FREE, YAW_BINS, type Scene } from "./types";

export const isSupportClause = (clause: PlaceClause) => clause.k === "inside" ||
  clause.k === "on" && ["instance", "surface", "compartment"].includes(clause.ref.kind);

export function solveSupported(scene: Scene, candidate: Candidate, place: PlaceClause[]): Solution {
  const supports = place.filter(isSupportClause), dropped: Dropped[] = [];
  const blank = (reason: string): Solution => ({ masks: YAW_BINS.map(yaw => fillMask(newMask(scene.room,yaw),()=>BLOCKED)),
    dropped, legalCounts: YAW_BINS.map(()=>0), bestYawIndex: -1, whyNothingFits: reason });
  if (supports.length !== 1) return blank("Choose one support surface or compartment");
  let selected: ReturnType<typeof supportForRef>;
  try { selected=supportForRef(supports[0].ref,scene.instances,scene.products); }
  catch (error) { return blank(error instanceof Error ? error.message : "Support unavailable"); }
  const { parent, target, profile }=selected;
  const other=placeToCm(place.filter(c=>!isSupportClause(c))), clearances=wallClearances(other);
  const rules: Rule[]=[doorSwingRule(scene)];
  for (const clause of other) {
    const resolved=resolveClause(scene,candidate.product,clause,clearances);
    if ("dropped" in resolved) dropped.push({clause,reason:resolved.dropped});
    else rules.push(resolved.rule);
  }
  const products=scene.products.some(p=>p.productId===candidate.product.productId)?scene.products:[...scene.products,candidate.product];
  let id=candidate.movingInstanceId??"__supported_candidate__";
  while (!candidate.movingInstanceId && scene.instances.some(i=>i.instanceId===id)) id+="_";
  const others=scene.instances.filter(i=>i.instanceId!==id);
  const masks=YAW_BINS.map(yawRad=>{
    const template=attachAt(parent,target,profile,localToWorld(parent.pose,{xCm:target.xCm,zCm:target.zCm,yawRad:0,yCm:target.yCm}));
    const mask=fillMask(newMask(scene.room,yawRad),(xCm,zCm)=>{
      const pose={xCm,zCm,yawRad,yCm:target.yCm};
      const local=worldToLocal(parent.pose,pose);
      // Avoid constructing a scene for thousands of points outside the selected support.
      if (Math.abs(local.xCm-target.xCm)>target.widthCm/2 || Math.abs(local.zCm-target.zCm)>target.depthCm/2) return BLOCKED;
      const attachment={...template,localPose:local};
      const item={instanceId:id,productId:candidate.product.productId,pose,attachment};
      return rules.every(rule=>rule(pose,footprintRect(candidate.product,pose))) &&
        validatePlacement(scene.room,products,[...others,item],id,pose,attachment).valid ? FREE : BLOCKED;
    });
    return {...mask,heightCm:target.yCm,attachment:template};
  });
  const legalCounts=masks.map(countFree),most=Math.max(...legalCounts);
  return {masks,dropped,legalCounts,bestYawIndex:most>0?legalCounts.indexOf(most):-1,
    ...(most>0?{}:{whyNothingFits:"No position fits this support's edges, headroom and obstacles"})};
}
