import type { Instance } from "./types";

/** An unsaved layout parked in the browser, per room, so leaving a room never costs an edit. */
export type Pending = { baseRevision: number; instances: Instance[] };
export type PendingStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const key = (roomId: string) => `friday:pending-scene:${roomId}`;

/** Returns whether the layout is now durably in the browser. Private mode and a full quota both say no. */
export function parkPending(store: PendingStore | undefined, roomId: string, pending: Pending): boolean {
  if (!store) return false;
  try { store.setItem(key(roomId), JSON.stringify(pending)); return true; } catch { return false; }
}

export function clearPending(store: PendingStore | undefined, roomId: string): void {
  try { store?.removeItem(key(roomId)); } catch { /* nothing to clear */ }
}

/** Take the parked layout for a room, if it was made against the revision the server still has. */
export function takePending(store: PendingStore | undefined, roomId: string, serverRevision: number): Instance[] | null {
  let raw: string | null = null;
  try { raw = store?.getItem(key(roomId)) ?? null; } catch { return null; }
  if (!raw) return null;
  clearPending(store, roomId);
  try {
    const parsed = JSON.parse(raw) as Pending;
    // Someone else changed the room since: replaying a stale layout over theirs is not ours to decide.
    return parsed.baseRevision === serverRevision && Array.isArray(parsed.instances) ? parsed.instances : null;
  } catch { return null; }
}
