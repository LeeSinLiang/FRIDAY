import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS, ROOM, ROOM_ID } from "./fixtures";
import { clearPending, parkPending, takePending, type PendingStore } from "./pendingEdits";
import { resolveAttachments } from "./supports";
import { validInlineProduct } from "./products";
import type { Instance, Product } from "./types";

export type SyncStatus = "loading" | "saved" | "saving" | "unsaved" | "offline" | "conflict";
type Snapshot = { instances: Instance[]; revision: number };
/** `saveFailures` counts consecutive failed saves; above zero, the room is safe here but not yet on the server. */
type SyncState = { ready: boolean; status: SyncStatus; message: string; revision: number | null; saveFailures?: number;
  /** True when the layout on screen is either saved or durably parked in this browser: leaving the room loses nothing. */
  safeToLeave?: boolean };
type Options = { instances: Instance[]; replace: (instances: Instance[]) => void; interactionActive: boolean };

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 8000;
/** Failed saves before the status line admits to it. Until then it just says it is saving. */
const QUIET_FAILURES = 4;

/** A failure that can clear on its own: the server answered 5xx, typically "storage is busy". */
class TransientError extends Error {
  constructor(readonly status: number) { super("The server is busy."); }
}
const isTransient = (error: unknown) =>
  error instanceof TransientError || (error instanceof Error && /fetch|network|load failed/i.test(error.message));

/** Failed saves after which leaving the room is allowed again. */
export const LEAVE_AFTER_FAILURES = 2;

/**
 * May the user switch rooms right now? Switching reloads the page. While a save is merely pending
 * that would drop the edit, so wait for it. But a save that keeps failing must never trap someone
 * in a room: after a couple of failures the layout is parked in the browser and the way out reopens.
 */
export const canLeaveRoom = (state: { status: SyncStatus; saveFailures?: number; safeToLeave?: boolean }, dragging: boolean): boolean => {
  if (dragging) return false;
  if (state.status === "saved" || state.status === "conflict") return true; // nothing to lose, or already lost to a reload
  const stuck = state.status === "offline" || (state.saveFailures ?? 0) >= LEAVE_AFTER_FAILURES;
  // Being stuck is not enough. The way out only opens once the layout is actually in browser storage:
  // private mode, a full quota or a refused save must not turn "you may leave" into "you lost it".
  return stuck && state.safeToLeave === true;
};

export function sceneFingerprint(instances: Instance[]): string {
  return JSON.stringify(instances.map(({ instanceId, productId, pose, product, attachment }) => ({
    instanceId, productId, pose: { xCm: pose.xCm, zCm: pose.zCm, yawRad: pose.yawRad, ...(pose.yCm === undefined ? {} : {yCm: pose.yCm}) }, ...(attachment ? {attachment} : {}),
    // Carried products are part of what gets saved; fixture instances serialize exactly as before.
    ...(product ? { product } : {}),
  })));
}

/** Reject malformed or incompatible snapshots before they can replace editor state. */
export function parseSceneSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object") throw Error("Invalid scene response");
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0 ||
    !Array.isArray(data.instances) || data.instances.length > 100 || !Array.isArray(data.products))
    throw Error("Invalid scene response");
  const room = data.room as Record<string, unknown> | undefined;
  if (!room || room.roomId !== ROOM.roomId || room.widthCm !== ROOM.widthCm ||
    room.depthCm !== ROOM.depthCm || room.heightCm !== ROOM.heightCm)
    throw Error("The server room differs from this editor. Reload the application.");
  const known = new Set(PRODUCTS.map((product) => product.productId));
  const serverProducts = new Set(data.products.map((product: unknown) =>
    product && typeof product === "object" ? (product as Record<string, unknown>).productId : null));
  const ids = new Set<string>();
  const instances = data.instances.map((item: unknown): Instance => {
    if (!item || typeof item !== "object") throw Error("Invalid scene object");
    const instance = item as Record<string, unknown>;
    const pose = instance.pose as Record<string, unknown> | undefined;
    if (typeof instance.instanceId !== "string" || !instance.instanceId.trim() || ids.has(instance.instanceId) ||
      typeof instance.productId !== "string" || !serverProducts.has(instance.productId) ||
      !(known.has(instance.productId) || validInlineProduct(instance.product, instance.productId)) ||
      !pose || ![pose.xCm, pose.zCm, pose.yawRad].every((number) => typeof number === "number" && Number.isFinite(number)))
      throw Error("Invalid scene object");
    ids.add(instance.instanceId);
    const carried = !known.has(instance.productId) && validInlineProduct(instance.product, instance.productId) ? instance.product : undefined;
    return { instanceId: instance.instanceId, productId: instance.productId,
      pose: { xCm: pose.xCm as number, zCm: pose.zCm as number, yawRad: pose.yawRad as number, ...(pose.yCm === undefined ? {} : {yCm: pose.yCm as number}) },
      ...(instance.attachment ? {attachment: instance.attachment as Instance["attachment"]} : {}),
      ...(carried ? { product: carried } : {}) };
  });
  return { revision: data.revision as number, instances: resolveAttachments(instances, data.products as Product[]) };
}

function readCsrfToken(): string | null {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

/** One effect-owned sync lifetime; transport injection keeps async races testable. */
export function createSceneSyncController(
  latest: { current: Options },
  onState: (state: SyncState) => void,
  transport: { fetch?: typeof fetch; csrfToken?: () => string | null; storage?: PendingStore; roomId?: string } = {},
) {
    let disposed = false;
    let ready = false;
    let revision: number | null = null;
    let baseline = "";
    let blocked: "offline" | "conflict" | null = null;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saveFailures = 0;
    let parkedFingerprint: string | null = null; // the layout known to be in browser storage, if any
    let unreachable = false; // the last background poll failed; cleared by any successful request
    const storage = transport.storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    const roomId = transport.roomId ?? ROOM_ID ?? "default";
    let controller: AbortController | null = null;
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const dirty = () => ready && sceneFingerprint(latest.current.instances) !== baseline;
    const publish = (status: SyncStatus, message: string) => {
      if (!disposed) onState({ ready, status, message, revision, saveFailures, safeToLeave: !dirty() || parkedFingerprint === sceneFingerprint(latest.current.instances) });
    };
    const replace = (snapshot: Snapshot) => {
      baseline = sceneFingerprint(snapshot.instances);
      revision = snapshot.revision;
      // Keep async callbacks current until React commits the replacement render.
      latest.current = { ...latest.current, instances: snapshot.instances };
      latest.current.replace(snapshot.instances);
      ready = true;
      blocked = null;
    };
    // The room is authoritative in the browser during interaction; the server is where it durably
    // lands. A storage problem may delay a save. It may never refuse a placement, and it never puts
    // a status code in front of the user: a save that fails for a reason that can clear on its own
    // (the server is busy, the network blinked) is retried quietly with backoff, for as long as it takes.
    const savePending = (): [SyncStatus, string] => saveFailures >= QUIET_FAILURES
      ? ["offline", "Still saving your room. It is safe in this browser."]
      : saveFailures > 0 ? ["unsaved", "Saving your room…"]
      : ["unsaved", latest.current.interactionActive ? "Editing · changes pending" : "Changes pending…"];
    const saveDelay = () => saveFailures === 0 ? 400 : Math.min(RETRY_BASE_MS * 2 ** (saveFailures - 1), RETRY_MAX_MS);
    // The parked copy must always be the layout on screen, not the layout at the last failed save: an
    // edit made after the failure, or an undo back to the saved state, would otherwise be lost or
    // resurrected on the next visit. Called on every reconcile, so it follows every edit.
    const syncParked = () => {
      if (!ready || revision === null) return;
      const troubled = saveFailures > 0 || blocked === "offline";
      if (!dirty() || !troubled) {
        if (parkedFingerprint !== null) { clearPending(storage, roomId); parkedFingerprint = null; }
        return;
      }
      const current = sceneFingerprint(latest.current.instances);
      if (current === parkedFingerprint) return;
      parkedFingerprint = parkPending(storage, roomId, { baseRevision: revision, instances: JSON.parse(current) }) ? current : null;
    };
    const failed = (error: unknown, saving = false) => {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
      if (ready && isTransient(error)) {
        // Once the room has loaded, nothing transient blocks anything. A failed SAVE is counted,
        // parked in the browser so the room can be left or reloaded without losing it, and retried
        // by reconcile(). A failed background POLL is just noted: blocking here would stop saves
        // altogether, so an item placed while the server was down would be neither retried nor parked.
        if (saving) {
          saveFailures += 1;
          syncParked();
        } else {
          unreachable = true;
        }
        return;
      }
      blocked = "offline";
      syncParked(); // a refused save (400, 403) leaves a dirty layout too: park it before the way out opens
      publish("offline", error instanceof Error && !isTransient(error)
        ? error.message : ready ? "Cannot reach the server. Local changes are retained." : "Cannot load the saved room. Retry to connect.");
    };
    const request = async (method: "GET" | "PUT", body?: unknown) => {
      controller = new AbortController();
      const headers: Record<string, string> = { Accept: "application/json" };
      if (method === "PUT") {
        const token = transport.csrfToken ? transport.csrfToken() : readCsrfToken();
        if (!token) throw Error("Missing CSRF token. Reload the saved room before saving.");
        headers["X-CSRFToken"] = token;
        headers["Content-Type"] = "application/json";
      }
      const response = await (transport.fetch ?? fetch)("/api/scene/", { method, credentials: "same-origin", cache: "no-store", headers,
        signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.status === 409) {
        blocked = "conflict";
        publish("conflict", "The saved room changed elsewhere. Reload it to replace these local changes.");
        return null;
      }
      if (response.status >= 500) throw new TransientError(response.status);
      if (!response.ok) throw Error(`Scene request failed (${response.status}). Local changes are retained.`);
      unreachable = false;
      return parseSceneSnapshot(await response.json());
    };
    const reconcile = () => {
      clearTimer();
      syncParked();
      if (disposed || !ready || inFlight || blocked) return;
      if (!dirty()) {
        saveFailures = 0;
        if (unreachable) publish("offline", "Reconnecting. Your room is safe in this browser.");
        else publish("saved", "All changes saved");
        return;
      }
      publish(...savePending());
      if (!latest.current.interactionActive) timer = setTimeout(() => { void save(); }, saveDelay());
    };
    const save = async () => {
      clearTimer();
      if (disposed || !ready || inFlight || blocked || !dirty() || latest.current.interactionActive) return;
      inFlight = true;
      const submitted = sceneFingerprint(latest.current.instances);
      const instances = JSON.parse(submitted) as Instance[];
      if (saveFailures === 0) publish("saving", "Saving room…");
      try {
        const snapshot = await request("PUT", { baseRevision: revision, instances });
        if (disposed || !snapshot) return;
        saveFailures = 0;
        clearPending(storage, roomId);
        parkedFingerprint = null;
        baseline = sceneFingerprint(snapshot.instances);
        revision = snapshot.revision;
        if (sceneFingerprint(latest.current.instances) === submitted && baseline !== submitted) replace(snapshot);
        blocked = null;
      } catch (error) { failed(error, true); }
      finally { inFlight = false; if (!disposed && !blocked) reconcile(); }
    };
    const load = async (force: boolean) => {
      if (disposed || inFlight || (!force && (dirty() || latest.current.interactionActive || blocked === "conflict"))) return;
      clearTimer();
      inFlight = true;
      if (force) { ready = false; blocked = null; publish("loading", "Loading saved room…"); }
      const original = sceneFingerprint(latest.current.instances);
      try {
        const snapshot = await request("GET");
        if (disposed || !snapshot) return;
        const locallyChanged = sceneFingerprint(latest.current.instances) !== original;
        if (!force && (locallyChanged || latest.current.interactionActive)) {
          if (snapshot.revision !== revision) {
            blocked = "conflict";
            publish("conflict", "The room changed elsewhere while you were editing. Reload to use the saved version.");
          }
          return;
        }
        if (force || snapshot.revision !== revision || sceneFingerprint(snapshot.instances) !== baseline) replace(snapshot);
        // Coming back to a room that was left with an unsaved layout: put it back, and the normal
        // save path sends it. Only if the server still has the revision it was made against.
        const parked = force ? takePending(storage, roomId, snapshot.revision) : null;
        if (parked) {
          latest.current = { ...latest.current, instances: parked };
          latest.current.replace(parked);
        }
        blocked = null;
      } catch (error) { failed(error); }
      finally { inFlight = false; if (!disposed && !blocked) reconcile(); }
    };
    const operations = {
      reconcile,
      retry: () => {
        if (inFlight || blocked === "conflict") return;
        blocked = null;
        saveFailures = 0; // a person asked: try now, not after the backoff
        if (!ready) void load(true);
        else if (dirty()) reconcile();
        else void load(false);
      },
      reload: () => {
        // Do not abort an uncertain PUT and accidentally report stale data as saved.
        if (!inFlight) void load(true);
      },
    };
    void load(true);
    const poll = setInterval(() => {
      if (ready && !dirty() && !latest.current.interactionActive && !inFlight && blocked !== "conflict") void load(false);
    }, 2000);
    return { ...operations, dispose: () => {
      disposed = true;
      clearTimer();
      clearInterval(poll);
      controller?.abort();
    } };
}

export function useSceneSync(options: Options) {
  const localOnly = import.meta.env.DEV && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("testAssets");
  const [state, setState] = useState<SyncState>(() => localOnly
    ? { ready: true, status: "unsaved", message: "Local test fixtures", revision: null }
    : { ready: false, status: "loading", message: "Loading saved room…", revision: null });
  const latest = useRef(options);
  latest.current = options;
  const operations = useRef({ reconcile: () => {}, retry: () => {}, reload: () => {} });
  useEffect(() => {
    if (localOnly) return;
    const controller = createSceneSyncController(latest, setState);
    operations.current = controller;
    return () => {
      controller.dispose();
      operations.current = { reconcile: () => {}, retry: () => {}, reload: () => {} };
    };
  }, [localOnly]);
  useEffect(() => { operations.current.reconcile(); }, [options.instances, options.interactionActive]);
  const retry = useCallback(() => operations.current.retry(), []);
  const reload = useCallback(() => operations.current.reload(), []);
  return { ...state, retry, reload };
}
