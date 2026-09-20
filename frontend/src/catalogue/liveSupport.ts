import type { PlaceClause } from "../lib/dsl/schema";

type Support = { id: string; name: string };

/** The compiler still uses mock room references. Resolve the stageable, explicit support phrase
 * against the actual room instead; an absent or ambiguous support must light no floor. */
export function resolveLiveSupport(text: string, place: PlaceClause[], supports: Support[]): PlaceClause[] {
  const kind = /\bon\s+(?:the|a|an)\s+(table|desk)\b/i.exec(text)?.[1]?.toLowerCase();
  if (!kind) return place;
  const matches = supports.filter(support => new RegExp(`\\b${kind}\\b`, "i").test(support.name));
  const id = matches.length === 1 ? matches[0].id : "__unresolved_support__";
  return [...place.filter(clause => clause.k !== "on"), { k: "on", ref: { kind: "instance", id } }];
}
