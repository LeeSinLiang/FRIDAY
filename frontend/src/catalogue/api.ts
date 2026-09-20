// Calls to the catalogue lane's endpoints. The one place the app's UI meets /api/search and /api/compile.

import type { FindClause, Program } from "../lib/dsl/schema";
import type { SearchResponse } from "../lib/types";

export type Compiled = { program: Program; chips: string[]; source: string; ms: number };

const PARAM_BY_CLAUSE: Record<FindClause["k"], string> = {
  text: "q", category: "category", price_max: "price_max", price_min: "price_min",
  colour: "colour", material: "material", fits_w_max: "fits_w_mm",
};

/** find[] -> GET /api/search params. Repeated clauses repeat the param; the API ANDs them. */
export function searchParams(find: FindClause[], limit = 12): URLSearchParams {
  const params = new URLSearchParams({ limit: String(limit) });
  for (const clause of find) {
    const value = "q" in clause ? clause.q : "value" in clause ? clause.value : "cents" in clause ? clause.cents : "hex" in clause ? clause.hex : clause.mm;
    params.append(PARAM_BY_CLAUSE[clause.k], String(value));
  }
  return params;
}

async function json<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body?.detail ?? `HTTP ${response.status}`);
  return body as T;
}

export const compileSentence = (text: string, signal: AbortSignal): Promise<Compiled> =>
  fetch("/api/compile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal }).then((r) => json<Compiled>(r));

export const searchCatalogue = (find: FindClause[], signal: AbortSignal): Promise<SearchResponse> =>
  fetch(`/api/search?${searchParams(find)}`, { signal }).then((r) => json<SearchResponse>(r));
