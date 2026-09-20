import { useCallback, useEffect, useRef, useState } from "react";
import type { CameraMode, FirstPersonCamera, Instance, Product, Room } from "./types";
import type { CaptureAngle } from "./captureCamera";

export type CaptureJob = {
  captureId: string; leaseToken: string; revision: number; view: CameraMode;
  camera: CaptureAngle | FirstPersonCamera | null; width: number; height: number;
  representation?: "photographic" | "spatial_plan";
  snapshot: { room: Room; products: Product[]; instances: Instance[]; revision: number };
};
export type CaptureResult = { imageDataUrl: string; modelWarnings: string[] } | { error: { code: string; message: string } };
export const MAX_CAPTURE_PNG_BYTES = 1536 * 1024;

/** Never spread unchecked cross-renderer values into the queue protocol. */
export function captureCompletionPayload(leaseToken: string, result: unknown) {
  if (result && typeof result === "object") {
    const data = result as Record<string, unknown>;
    if (typeof data.imageDataUrl === "string" && !("error" in data)) {
      return { leaseToken, imageDataUrl: data.imageDataUrl,
        modelWarnings: Array.isArray(data.modelWarnings) ? data.modelWarnings.filter((warning): warning is string => typeof warning === "string").slice(0, 100).map(warning => warning.slice(0, 500)) : [] };
    }
    if (data.error && typeof data.error === "object" && !("imageDataUrl" in data)) {
      const error = data.error as Record<string, unknown>;
      return { leaseToken, error: {
        code: typeof error.code === "string" && error.code.trim() ? error.code.trim().slice(0, 100) : "render_failed",
        message: typeof error.message === "string" && error.message.trim() ? error.message.trim().slice(0, 1000) : "The capture renderer failed without an error message.",
      } };
    }
  }
  return { leaseToken, error: { code: "worker_protocol", message: "Renderer supplied an invalid completion payload. Reload this editor and retry." } };
}

export function parseCaptureJob(value: unknown): CaptureJob {
  if (!value || typeof value !== "object") throw Error("Invalid capture job");
  const job = value as CaptureJob;
  if (typeof job.captureId !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(job.captureId) ||
    typeof job.leaseToken !== "string" || !job.leaseToken || !["top", "perspective"].includes(job.view) ||
    !Number.isSafeInteger(job.revision) || job.revision < 0 ||
    ![job.width, job.height].every(n => Number.isInteger(n) && n >= 256 && n <= 1536) || job.width * job.height > 1_800_000 || !job.snapshot ||
    !Array.isArray(job.snapshot.products) || !Array.isArray(job.snapshot.instances) || job.snapshot.instances.length > 100 || job.snapshot.revision !== job.revision)
    throw Error("Invalid capture job");
  const room = job.snapshot.room;
  if (!room || ![room.widthCm, room.depthCm, room.heightCm].every(n => Number.isFinite(n) && n > 0)) throw Error("Invalid capture room");
  if (job.view === "perspective" && job.camera) {
    if ("kind" in job.camera) {
      const c = job.camera;
      if (c.kind !== "firstPerson" || ![c.xCm,c.yCm,c.zCm,c.yawRad,c.pitchRad,c.fovDeg].every(Number.isFinite) || c.fovDeg < 20 || c.fovDeg > 100)
        throw Error("Invalid first-person capture camera");
    } else if (!Number.isFinite(job.camera.azimuthDeg) || !Number.isFinite(job.camera.elevationDeg) || job.camera.elevationDeg <= 0 || job.camera.elevationDeg >= 90) throw Error("Invalid capture angle");
  }
  const products = new Map(job.snapshot.products.map(product => [product.productId, product]));
  const ids = new Set<string>();
  for (const instance of job.snapshot.instances) {
    const product = products.get(instance.productId);
    if (!product || ![product.widthCm, product.depthCm, product.heightCm].every(n => Number.isFinite(n) && n > 0) ||
      typeof instance.instanceId !== "string" || !instance.instanceId || ids.has(instance.instanceId) || !instance.pose ||
      ![instance.pose.xCm, instance.pose.zCm, instance.pose.yawRad].every(Number.isFinite)) throw Error("Invalid capture furniture");
    ids.add(instance.instanceId);
  }
  return structuredClone(job);
}

export function useCaptureWorker(enabled: boolean, roomId = "demo-room") {
  const [job, setJob] = useState<CaptureJob | null>(null);
  const completeRef = useRef<(captureId: string, leaseToken: string, result: CaptureResult) => void>(() => {});
  useEffect(() => {
    // Fast Refresh/StrictMode may preserve React state while replacing this
    // queue lifetime. Never leave a canvas belonging to the disposed lease.
    setJob(null);
    if (!enabled) return;
    let disposed = false;
    let active: CaptureJob | null = null;
    let completing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requestController: AbortController | undefined;
    const post = async (path: string, body: unknown) => {
      requestController = new AbortController();
      const token = document.cookie.split(";").map(part => part.trim()).find(part => part.startsWith("csrftoken="))?.slice(10);
      if (!token) throw Error("Missing CSRF token");
      const timeout = setTimeout(() => requestController?.abort(), 5000);
      try {
        const response = await fetch(`${path}?roomId=${encodeURIComponent(roomId)}`, { method: "POST", credentials: "same-origin", signal: requestController.signal,
          headers: { "Content-Type": "application/json", "X-CSRFToken": decodeURIComponent(token) }, body: JSON.stringify(body) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw Error(`Capture request failed (${response.status}): ${data?.error?.message ?? response.statusText}`);
        if (!data) throw Error("Capture server returned a non-JSON response");
        return data;
      } finally { clearTimeout(timeout); }
    };
    const schedule = () => { if (!disposed) timer = setTimeout(() => { void claim(); }, 1000); };
    const claim = async () => {
      if (disposed || active) return;
      try {
        const response = await post("/api/scene/captures/claim/", {});
        if (disposed) return;
        if (response.job) { active = parseCaptureJob(response.job); setJob(active); return; }
      } catch { /* The queue survives a disconnected renderer; retry without changing editor state. */ }
      schedule();
    };
    completeRef.current = (captureId, leaseToken, result) => {
      if (disposed || !active || active.captureId !== captureId || active.leaseToken !== leaseToken || completing) return;
      completing = true;
      const claimed = active;
      void (async () => {
        try {
          await post(`/api/scene/captures/${claimed.captureId}/complete/`, captureCompletionPayload(claimed.leaseToken, result));
        } catch (error) {
          console.warn("Capture completion rejected", claimed.captureId, error instanceof Error ? error.message : "Unknown completion error");
          // If image validation/upload failed, make that failure inspectable.
          // A ready job rejects this second completion, preserving a lost success.
          if (!disposed) {
            try { await post(`/api/scene/captures/${claimed.captureId}/complete/`, captureCompletionPayload(claimed.leaseToken, {
              error: { code: "upload_failed", message: error instanceof Error ? error.message : "Capture upload failed" } })); }
            catch { /* An unreachable worker leaves recovery to the backend lease. */ }
          }
        }
        finally {
          if (!disposed) { active = null; completing = false; setJob(null); schedule(); }
        }
      })();
    };
    void claim();
    return () => {
      disposed = true;
      clearTimeout(timer);
      requestController?.abort();
      completeRef.current = () => {};
      // An interrupted claim is deliberately left for the backend's lease recovery.
    };
  }, [enabled, roomId]);
  const complete = useCallback((captureId: string, leaseToken: string, result: CaptureResult) => completeRef.current(captureId, leaseToken, result), []);
  return { job: enabled ? job : null, complete };
}
