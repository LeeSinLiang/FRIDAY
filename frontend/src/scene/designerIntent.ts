/** Ordinary catalogue queries remain searches; explicit layout requests use the scene agent. */
export function isDesignerRequest(text: string): boolean {
  const value = text.trim().replace(/^(?:(?:please|can you|could you|i want you to)\s+)+/i, "");
  if (/^place\s+mats?\b/i.test(value)) return false;
  return /^(?:add|place|put|move|rotate|remove|delete|arrange|rearrange|decorate|furnish|clear|inspect|describe)\b/i.test(value)
    || /^(?:what(?:'s| is| are)|where is)\b.*\b(?:room|scene|selected|chair|table|sofa|lamp)\b/i.test(value);
}
