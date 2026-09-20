import assert from "node:assert/strict";
import test from "node:test";
import { acceptVariantRefinement, parseDesignVariantSet, type DesignVariantSet } from "./designVariants";

const fixture = (): DesignVariantSet => ({variantSetId:"set-1",roomId:"haussmann-apartment",baseRevision:12,budgetCents:120000,activeVariantId:"v1",
  variants:[1,2,3].map(number => ({id:`v${number}`,revision:0,label:`Bedroom ${number}`,totalCents:75000,geometryValidated:true,budgetValidated:true,
    products:["bed","couch"].map(productId=>({productId,name:productId,kind:"sofa",widthCm:100,depthCm:180,heightCm:70,color:"#bba"})),
    instances:["bed","couch"].map((productId,index)=>({instanceId:`${number}-${productId}`,productId,pose:{xCm:150+index*120,zCm:100+number*90,yawRad:0}})),
  }))});

test('draft parsing rejects stale scene revisions, missing variants and unchecked budgets',()=>{
  const source=fixture();
  const parsed=parseDesignVariantSet(source,source.roomId,12);
  parsed.variants[0].instances[0].pose.xCm=999;
  assert.equal(source.variants[0].instances[0].pose.xCm,150);
  assert.throws(()=>parseDesignVariantSet(source,source.roomId,13),/outdated/);
  source.variants.pop();
  assert.throws(()=>parseDesignVariantSet(source,source.roomId,12),/incomplete/);
  const costly=fixture();costly.variants[0].totalCents=120001;
  assert.throws(()=>parseDesignVariantSet(costly,costly.roomId,12),/budget/);
});

test('active-only refinement preserves asymmetric sibling snapshots and advances one revision',()=>{
  const before=fixture(),after=structuredClone(before);
  after.variants[0].revision++;
  after.variants[0].products[1].color="#63452f";
  const accepted=acceptVariantRefinement(before,after,"v1");
  assert.deepEqual(accepted.variants.slice(1),before.variants.slice(1));
  assert.deepEqual(accepted.variants[0].instances[0],before.variants[0].instances[0]);
  after.variants[2].instances[0].pose.zCm++;
  assert.throws(()=>acceptVariantRefinement(before,after,"v1"),/other designs/);
  assert.throws(()=>acceptVariantRefinement(before,before,"v1"),/other designs/);
});

test('explicit clarification preserves every draft without advancing its revision',()=>{
  const before=fixture(),after=structuredClone(before);
  assert.deepEqual(acceptVariantRefinement(before,after,"v2",true),before);
  after.variants[1].instances[0].pose.xCm++;
  assert.throws(()=>acceptVariantRefinement(before,after,"v2",true),/other designs/);
});
