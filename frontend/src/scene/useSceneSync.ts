import { useCallback, useEffect, useRef, useState } from "react";
import { PRODUCTS, ROOM } from "./fixtures";
import { validInlineProduct } from "./products";
import type { Instance } from "./types";

export type SyncStatus = "loading" | "saved" | "saving" | "unsaved" | "offline" | "conflict";
type Snapshot = { instances: Instance[]; revision: number };
type SyncState = { ready: boolean; status: SyncStatus; message: string; revision: number | null };
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

export function sceneFingerprint(instances: Instance[]): string {
  return JSON.stringify(instances.map(({ instanceId, productId, pose, product }) => ({
    instanceId, productId, pose: { xCm: pose.xCm, zCm: pose.zCm, yawRad: pose.yawRad },
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
      pose: { xCm: pose.xCm as number, zCm: pose.zCm as number, yawRad: pose.yawRad as number },
      ...(carried ? { product: carried } : {}) };
  });
  return { revision: data.revision as number, instances };
}

function readCsrfToken(): string | null {
  const cookie = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("csrftoken="));
  return cookie ? decodeURIComponent(cookie.slice("csrftoken=".length)) : null;
}

/** One effect-owned sync lifetime; transport injection keeps async races testable. */
export function createSceneSyncController(
  latest: { current: Options },
  onState: (state: SyncState) => void,
  transport: { fetch?: typeof fetch; csrfToken?: () => string | null } = {},
) {
    let disposed = false;
    let ready = false;
    let revision: number | null = null;
    let baseline = "";
    let blocked: "offline" | "conflict" | null = null;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let saveFailures = 0;
    let controller: AbortController | null = null;
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const dirty = () => ready && sceneFingerprint(latest.current.instances) !== baseline;
    const publish = (status: SyncStatus, message: string) => {
      if (!disposed) onState({ ready, status, message, revision });
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
    const failed = (error: unknown, saving = false) => {
      if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
      if (saving && ready && isTransient(error)) { saveFailures += 1; return; } // reconcile() schedules the retry
      blocked = "offline";
      publish("offline", error instanceof Error && !/fetch|network|load failed/i.test(error.message)
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
      return parseSceneSnapshot(await response.json());
    };
    const reconcile = () => {
      clearTimer();
      if (disposed || !ready || inFlight || blocked) return;
      if (!dirty()) { saveFailures = 0; publish("saved", "All changes saved"); return; }
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
