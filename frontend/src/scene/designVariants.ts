import type { Instance, Product } from "./types";

export type DesignVariant = {
  id: string; revision: number; label: string; instances: Instance[]; products: Product[];
  totalCents: number; geometryValidated: boolean; budgetValidated: boolean;
};
export type DesignVariantSet = {
  variantSetId: string; roomId: string; baseRevision: number; budgetCents: number;
  activeVariantId: string; variants: DesignVariant[]; source?: string; message?: string;
};

/** Reject incomplete or stale sets before exposing them as selectable drafts. */
export function parseDesignVariantSet(value: unknown, roomId: string, baseRevision: number): DesignVariantSet {
  const set = value as DesignVariantSet | null;
  if (!set || typeof set.variantSetId !== "string" || set.roomId !== roomId || set.baseRevision !== baseRevision
    || !Number.isSafeInteger(set.budgetCents) || set.budgetCents <= 0 || !Array.isArray(set.variants) || set.variants.length !== 3
    || new Set(set.variants.map(v => v.id)).size !== 3 || !set.variants.some(v => v.id === set.activeVariantId))
    throw Error("The designer returned incomplete or outdated designs. Please try again.");
  for (const variant of set.variants) {
    if (!variant.id || !Number.isSafeInteger(variant.revision) || variant.revision < 0 || typeof variant.label !== "string"
      || !Array.isArray(variant.instances) || variant.instances.length < 2 || !Array.isArray(variant.products)
      || !variant.geometryValidated || !variant.budgetValidated || !Number.isSafeInteger(variant.totalCents)
      || variant.totalCents <= 0 || variant.totalCents > set.budgetCents)
      throw Error("A design has not passed its room and budget checks.");
    const products = new Map(variant.products.map(product => [product.productId, product]));
    if (products.size !== variant.products.length || variant.products.some(product => !product.productId || !product.name
      || ![product.widthCm,product.depthCm,product.heightCm].every(value => Number.isFinite(value) && value > 0))
      || new Set(variant.instances.map(item => item.instanceId)).size !== variant.instances.length
      || variant.instances.some(item => !item.instanceId || !products.has(item.productId) || !item.pose
        || ![item.pose.xCm,item.pose.zCm,item.pose.yawRad].every(Number.isFinite)))
      throw Error("A design contains incomplete furniture data.");
  }
  return structuredClone(set);
}

export function acceptVariantRefinement(before: DesignVariantSet, after: DesignVariantSet, variantId: string, clarification = false): DesignVariantSet {
  if (before.variantSetId !== after.variantSetId || before.baseRevision !== after.baseRevision)
    throw Error("The design changed during this request. Please try again.");
  for (const previous of before.variants) {
    const next = after.variants.find(variant => variant.id === previous.id);
    if (!next || (previous.id === variantId && !clarification ? next.revision !== previous.revision + 1 : JSON.stringify(next) !== JSON.stringify(previous)))
      throw Error("The refinement did not preserve your other designs.");
  }
  return after;
}

export const designPrice = (cents: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",maximumFractionDigits:0}).format(cents / 100);
