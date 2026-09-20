import type { InteractionMode } from "./playcanvas/contracts";

export type WalkKeyPress = { key: string; repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean };
export type WalkKeyState = { mode: InteractionMode; pointerLocked: boolean; active: boolean; pieceInHand: boolean };

/**
 * Whether a piece is in hand, in either hand. The furniture rail holds one as the editor's pendingProductId; the
 * catalogue search panel holds one on the engine, as runtime.externalHold (set by SplatCatalogueLayer). Anything
 * that must not happen "while holding" has to ask about both, or it is only true for the rail.
 */
export const pieceInHand = (pendingProductId: string | null, runtime: { externalHold?: boolean } | null | undefined): boolean =>
  !!pendingProductId || !!runtime?.externalHold;

/**
 * What a key press asks of walking. "toggle" is F, entering or leaving walk mode; "capture" is W A S D reaching for
 * the pointer on the way into a walk. Neither may happen with a piece in hand: capturing the pointer hides the cursor
 * with the piece still held, and the only way out, Esc, also drops it. With nothing in hand the conditions are the
 * ones the editor's key handler always had.
 */
export function walkKeyAction(press: WalkKeyPress, state: WalkKeyState): "toggle" | "capture" | null {
  if (state.pieceInHand) return null;
  if (press.key.toLowerCase() === "f" && !press.repeat && !press.metaKey && !press.ctrlKey && !press.altKey && !state.active) return "toggle";
  if (state.mode === "walk" && !state.pointerLocked && !press.repeat && /^[wasd]$/i.test(press.key)) return "capture";
  return null;
}
