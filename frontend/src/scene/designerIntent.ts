const cueOnly = /^do\s+it\s+now[.!?]*$/i;
const cue = /\bdo\s+it\s+now\b/gi;
const actionWord = /\b(?:add|place|put|move|rotate|remove|delete|arrange|rearrange|decorate|furnish|design|build|create|clear|inspect|describe)\b/gi;
const startsWithAction = /^(?:(?:please|can you|could you|i want you to)\s+)*(?:add|place|put|move|rotate|remove|delete|arrange|rearrange|decorate|furnish|design|build|create|clear|inspect|describe)\b/i;

export function isDoItNowCue(text: string): boolean {
  return cueOnly.test(text.trim());
}

/** Return the exact instruction to send to the scene agent, or null for catalogue search. */
export function designerInstruction(text: string, priorDraft = ""): string | null {
  const spoken = text.trim();
  const lastCue = [...spoken.matchAll(cue)].at(-1);
  const hasCue = !!lastCue;
  let value = spoken;
  if (lastCue) {
    // Deepgram can include a sentence before or after the spoken command. The
    // explicit cue applies to the nearest action, not the entire recording.
    const before = spoken.slice(0, lastCue.index).replace(/[\s,.:;!?-]+$/, "").trim();
    const after = spoken.slice(lastCue.index! + lastCue[0].length).replace(/^[\s,.:;!?-]+/, "").trim();
    const precedingAction = [...before.matchAll(actionWord)].at(-1);
    value = startsWithAction.test(after) ? after
      : startsWithAction.test(before) ? before
      : precedingAction ? before.slice(precedingAction.index).trim()
      : before || after || priorDraft.trim();
  }
  if (!value) return null;
  // Conversational briefs often begin with a budget before the actual request.
  if (isBedroomDesignRequest(value) || isDesignLockRequest(value) || /\b(?:change|replace|make)\b.*\b(?:couch|sofa)\b/i.test(value)) return value;
  const action = value.replace(/^(?:(?:please|can you|could you|i want you to)\s+)+/i, "");
  if (hasCue) {
    // The cue makes a short product request an explicit placement. Never turn an
    // empty utterance into the input's initial catalogue placeholder.
    return /^(?:an?|the|some|\d+)\s+/i.test(action) ? `Place ${action}` : action;
  }
  if (/^place\s+mats?\b/i.test(action)) return null;
  return /^(?:add|place|put|move|rotate|remove|delete|arrange|rearrange|decorate|furnish|design|build|create|clear|inspect|describe)\b/i.test(action)
    || /^(?:what(?:'s| is| are)|where is)\b.*\b(?:room|scene|selected|chair|table|sofa|lamp)\b/i.test(action) ? value : null;
}

export function isBedroomDesignRequest(text: string): boolean {
  return (/\b(?:plan|design|furnish|decorate|arrange)\b[\s\S]*\broom\b/i.test(text)
      && /\b(?:couch|sofa)\b/i.test(text) && /\bbed\b/i.test(text))
    || /\b(?:plan|design|furnish|decorate|arrange|create)\b[\s\S]*\bbedroom\b/i.test(text)
    || /\bbedroom\b[\s\S]*\b(?:design|furnish|decorate|arrange)\b/i.test(text)
    || (/\bbedroom\b/i.test(text) && /(?:\$\s*\d|\bbudget\b)/i.test(text) && /\b(?:couch|sofa)\b/i.test(text) && /\bbed\b/i.test(text));
}

export function isDesignLockRequest(text: string): boolean {
  return /\block\s+(?:it|this|the design)\s+in\b/i.test(text);
}

/** Ordinary catalogue queries remain searches; explicit layout requests use the scene agent. */
export function isDesignerRequest(text: string): boolean {
  return designerInstruction(text) !== null;
}
