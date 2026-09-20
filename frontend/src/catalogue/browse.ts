import type { Category, Listing } from "../lib/types";
import { searchCatalogue } from "./api";

export const BROWSE_LIMIT = 20;
export const BROWSE_CATEGORIES = {
  Sofas: ["sofa"], Chairs: ["chair", "armchair"], Tables: ["table", "desk"],
  Storage: ["storage", "shelf"], Lighting: ["lamp"], Rugs: ["rug"], Decor: ["decor"], Plants: ["plant"],
} satisfies Record<string, Category[]>;
export type BrowseCategory = keyof typeof BROWSE_CATEGORIES;

/** Category clauses are ANDed by search. Request each constituent separately for a union. */
export async function browseCatalogue(category: BrowseCategory, signal: AbortSignal): Promise<{ items: Listing[]; total: number }> {
  const pages = await Promise.all(BROWSE_CATEGORIES[category].map(value =>
    searchCatalogue([{ k: "category", value }], signal, { limit: BROWSE_LIMIT, models: "only" })));
  // With no text query each category is in stable ID order, matching the API's tie breaker.
  const byId = new Map(pages.flatMap(page => page.items).map(item => [item.id, item]));
  const items = [...byId.values()].filter(item => item.model_url?.startsWith("/models/furniture/"))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).slice(0, BROWSE_LIMIT);
  return { items, total: pages.reduce((sum, page) => sum + page.total, 0) };
}
