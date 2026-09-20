import { Application, Color, GSPLATDATA_LARGE, Entity, FILLMODE_NONE, RESOLUTION_AUTO, TONEMAP_ACES2, TONEMAP_LINEAR, type EventHandle } from "playcanvas";
import type { FirstPersonCamera, Room } from "../types";
import { cmToScene } from "../units";
import { AssetCache } from "./assets";
import { createFurnitureLighting } from "./lighting";
import { loadSplatRoom } from "./room";

export type RuntimeStatus = { phase: "loading" | "ready" | "error"; message: string; progress?: number };
export type PlayCanvasRuntime = {
  app: Application;
  canvas: HTMLCanvasElement;
  camera: Entity;
  roomRoot: Entity;
  contentRoot: Entity;
  assets: AssetCache;
  room: Room;
  ready: Promise<void>;
  capturing: boolean;
  disposed: boolean;
  signal: AbortSignal;
  resize(): void;
  dispose(): void;
};

export function setFirstPersonCamera(camera: Entity, pose: FirstPersonCamera) {
  camera.setPosition(cmToScene(pose.xCm), cmToScene(pose.yCm), cmToScene(pose.zCm));
  camera.setEulerAngles(pose.pitchRad * 180 / Math.PI, pose.yawRad * 180 / Math.PI, 0);
  if (camera.camera) camera.camera.fov = pose.fovDeg;
}

/** Resolve after the engine confirms the camera's current splat sort and finishes drawing it. */
export function waitForSplatFrame(runtime: PlayCanvasRuntime, timeoutMs = 15_000, signal?: AbortSignal): Promise<void> {
  if (runtime.disposed || signal?.aborted) return Promise.reject(new Error("Rendering was cancelled"));
  const isMesh = runtime.room?.scan?.visualFormat === "glb";
  const system = runtime.app.systems.gsplat;
  if (!system && !isMesh) return Promise.reject(new Error("The Gaussian renderer is unavailable"));
  return new Promise((resolve, reject) => {
    let readyEvent: EventHandle | undefined;
    let endEvent: EventHandle | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      readyEvent?.off();
      endEvent?.off();
      runtime.signal.removeEventListener("abort", abort);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new Error("Rendering was cancelled"));
    const timer = setTimeout(() => finish(new Error("The Gaussian scene did not finish sorting in time")), timeoutMs);
    runtime.signal.addEventListener("abort", abort, { once: true });
    signal?.addEventListener("abort", abort, { once: true });
    if (isMesh) endEvent = runtime.app.once("frameend", () => finish());
    else readyEvent = system!.on("frame:ready", (camera, _layer, ready, loadingCount) => {
      if (camera !== runtime.camera.camera || !ready || loadingCount !== 0 || endEvent) return;
      endEvent = runtime.app.once("frameend", () => finish());
    });
    runtime.app.renderNextFrame = true;
  });
}

/** Synchronous ownership lets effect cleanup destroy the device before a React remount. */
export function createPlayCanvasRuntime(canvas: HTMLCanvasElement, options: {
  room: Room;
  onStatus?: (status: RuntimeStatus) => void;
}): PlayCanvasRuntime {
  const { room, onStatus } = options;
  if (!room.scan) throw new Error("The first-person renderer requires a prepared room scan");
  const importedInterior = room.roomId === "cg-arch-interior" || room.roomId === "cg-arch-lightmapper-proof";
  const app = new Application(canvas, {
    graphicsDeviceOptions: { antialias: room.scan.visualFormat === "glb", alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false },
  });
  // Compact unified storage smears this SH2 asset at reverse headings; matched PLY/SOG captures verify large storage.
  if (room.roomId === "haussmann-apartment") app.scene.gsplat.dataFormat = GSPLATDATA_LARGE;
  // The two-million-splat laptop proof sustains motion at this render resolution.
  // Agent captures still render at their independently requested pixel dimensions.
  app.graphicsDevice.maxPixelRatio = Math.min(window.devicePixelRatio || 1, room.scan.visualFormat === "glb" ? 1.5 : 1);
  app.setCanvasFillMode(FILLMODE_NONE);
  app.setCanvasResolution(RESOLUTION_AUTO);
  const camera = new Entity("Room camera");
  camera.addComponent("camera", {
    clearColor: new Color(0.89, 0.87, 0.83),
    nearClip: cmToScene(2),
    farClip: cmToScene(20_000),
    fov: room.scan.defaultCamera.fovDeg,
    toneMapping: TONEMAP_LINEAR,
  });
  setFirstPersonCamera(camera, room.scan.defaultCamera);
  const roomRoot = new Entity("Immutable room");
  const contentRoot = new Entity("Editable furniture");
  app.root.addChild(camera);
  // Imported glass uses glTF transmission, which samples the opaque scene.
  // The same camera also serves offscreen captures, retaining this grab pass.
  if (importedInterior) camera.camera!.requestSceneColorMap(true);
  app.root.addChild(roomRoot);
  app.root.addChild(contentRoot);
  const assets = new AssetCache(app);
  const disposeLights = createFurnitureLighting(app, importedInterior);
  const abortController = new AbortController();
  const runtime: PlayCanvasRuntime = {
    app, canvas, camera, roomRoot, contentRoot, assets, room,
    ready: Promise.resolve(), capturing: false, disposed: false, signal: abortController.signal,
    resize: () => {
      if (runtime.disposed) return;
      const box = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(box.width));
      const height = Math.max(1, Math.round(box.height));
      app.resizeCanvas(width, height);
      app.renderNextFrame = true;
    },
    dispose: () => {
      if (runtime.disposed) return;
      runtime.disposed = true;
      abortController.abort();
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", contextLost);
      canvas.removeEventListener("webglcontextrestored", contextRestored);
      contentRoot.destroy();
      roomRoot.destroy();
      disposeLights();
      assets.dispose();
      app.destroy();
    },
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    onStatus?.({ phase: "error", message: "The graphics context was lost. Reload the room to recover." });
  };
  const contextRestored = () => {
    if (!runtime.disposed) onStatus?.({ phase: "loading", message: "Restoring the room renderer…" });
    void waitForSplatFrame(runtime).then(() => onStatus?.({ phase: "ready", message: "Room ready" })).catch(() => {});
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);
  const observer = new ResizeObserver(runtime.resize);
  observer.observe(canvas.parentElement ?? canvas);
  runtime.resize();
  onStatus?.({ phase: "loading", message: "Loading the room…" });
  app.start();
  runtime.ready = loadSplatRoom(assets, roomRoot, room, ({ loaded, total }) => {
    if (!runtime.disposed) onStatus?.({ phase: "loading", message: "Loading the room…", progress: total > 0 ? loaded / total : undefined });
  }, runtime.signal).then(async model => {
    if (runtime.disposed) throw new Error("The renderer has been disposed");
    // The older atlas already contains its display transform. Only the explicit
    // linear RGBM workflow needs tone mapping; ACES2 approximates source AgX.
    if (model.tags.has("friday-linear-lightmap")) {
      camera.camera!.toneMapping = TONEMAP_ACES2;
      // Source Blender exposure is in stops; the exporter records its 2^EV scale.
      // Non-physical PlayCanvas cameras read scene.exposure for this uniform.
      app.scene.exposure = model.bakedExposureScale ?? 1;
    }
    onStatus?.({ phase: "loading", message: "Preparing the first view…" });
    await waitForSplatFrame(runtime, 30_000);
    if (!runtime.disposed) onStatus?.({ phase: "ready", message: "Room ready" });
  });
  void runtime.ready.catch(error => {
    if (!runtime.disposed) onStatus?.({ phase: "error", message: error instanceof Error ? error.message : "Unable to render the room" });
  });
  return runtime;
}
