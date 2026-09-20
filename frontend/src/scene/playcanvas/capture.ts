import { ASPECT_MANUAL, Entity, PIXELFORMAT_RGBA8, PROJECTION_PERSPECTIVE, RenderTarget, Texture } from "playcanvas";
import type { FirstPersonCamera } from "../types";
import { MAX_CAPTURE_PNG_BYTES, type CaptureJob, type CaptureResult } from "../useCaptureWorker";
import { createFurnitureEntity } from "./furniture";
import { supportHeightCm } from "../placement";
import { setFirstPersonCamera, waitForSplatFrame, type PlayCanvasRuntime } from "./runtime";

class CaptureError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

function encodePng(canvas: HTMLCanvasElement, warnings: string[]): CaptureResult {
  const imageDataUrl = canvas.toDataURL("image/png");
  if (!imageDataUrl.startsWith("data:image/png;base64,") || imageDataUrl.length < 100)
    throw new CaptureError("render_failed", "The capture image is empty");
  if (imageDataUrl.length > MAX_CAPTURE_PNG_BYTES * 4 / 3 + 22)
    throw new CaptureError("capture_too_large", "The PNG exceeds 1.5 MiB. Request a smaller capture.");
  return { imageDataUrl, modelWarnings: warnings };
}

/** A top capture is explicitly a plan. It never masquerades as a roofless photograph. */
export function captureSpatialPlan(job: CaptureJob): CaptureResult {
  const { room, products, instances } = job.snapshot;
  const canvas = document.createElement("canvas");
  canvas.width = job.width;
  canvas.height = job.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new CaptureError("render_failed", "The plan drawing context is unavailable");
  ctx.fillStyle = "#f5f0e8";
  ctx.fillRect(0, 0, job.width, job.height);
  ctx.fillStyle = "#362c26";
  ctx.font = `600 ${Math.min(20, job.width / 20)}px sans-serif`;
  ctx.fillText("SPATIAL PLAN · schematic", 20, 28);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#73695e";
  ctx.fillText(`${room.roomId} · layout ${job.revision} · geometry ${room.revision}`, 20, 47, job.width - 40);
  const margin = 28;
  const scale = Math.min((job.width - margin * 2) / room.widthCm, (job.height - 130) / room.depthCm);
  const originX = (job.width - room.widthCm * scale) / 2;
  const originY = 66 + (job.height - 130 - room.depthCm * scale) / 2;
  ctx.save();
  ctx.translate(originX, originY);
  ctx.scale(scale, scale);
  // Unobserved space remains visibly unavailable, even when no obstacle is listed.
  ctx.fillStyle = "#d9d5cf";
  ctx.fillRect(0, 0, room.widthCm, room.depthCm);
  ctx.fillStyle = "#e0eadb";
  for (const free of room.spatial?.freeAreas ?? [])
    ctx.fillRect(free.minXcm, free.minZcm, free.maxXcm - free.minXcm, free.maxZcm - free.minZcm);
  ctx.strokeStyle = "#c6c1b8";
  ctx.lineWidth = 0.5 / scale;
  // Keep the recorded coordinates exact while suppressing subpixel grid lines.
  const gridStep = 5 * Math.max(1, Math.ceil(4 / (5 * scale)));
  ctx.beginPath();
  for (let x = 0; x <= room.widthCm; x += gridStep) { ctx.moveTo(x, 0); ctx.lineTo(x, room.depthCm); }
  for (let z = 0; z <= room.depthCm; z += gridStep) { ctx.moveTo(0, z); ctx.lineTo(room.widthCm, z); }
  ctx.stroke();
  const rect = (x: number, z: number, width: number, depth: number, yaw: number, color: string, label: string) => {
    ctx.save();
    ctx.translate(x, z);
    ctx.rotate(-yaw);
    ctx.fillStyle = color;
    ctx.fillRect(-width / 2, -depth / 2, width, depth);
    ctx.strokeStyle = "#655749";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(-width / 2, -depth / 2, width, depth);
    ctx.fillStyle = "#332b24";
    ctx.font = `${10 / scale}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, 0, Math.max(1, width - 8 / scale));
    ctx.restore();
  };
  for (const obstacle of room.spatial?.obstacles ?? [])
    rect(obstacle.xCm, obstacle.zCm, obstacle.widthCm, obstacle.depthCm, obstacle.yawRad, "#c5a39c", obstacle.label);
  for (const instance of instances) {
    const product = products.find(item => item.productId === instance.productId);
    if (!product) throw new CaptureError("invalid_snapshot", "A placed product is missing from the frozen snapshot");
    rect(instance.pose.xCm, instance.pose.zCm, product.widthCm, product.depthCm, instance.pose.yawRad, "#e8b18c", product.name);
  }
  ctx.strokeStyle = "#615448";
  ctx.lineWidth = 2 / scale;
  ctx.strokeRect(0, 0, room.widthCm, room.depthCm);
  ctx.restore();
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#62594f";
  ctx.fillText("Green: reviewed region · Gray: unknown", 20, job.height - 38, job.width - 40);
  ctx.fillText("Rose: fixed obstacle · Orange: placed GLB", 20, job.height - 21, job.width - 40);
  const warnings = ["Schematic floor plan; furniture is represented by its authoritative footprint, not rendered geometry."];
  if (room.scan?.calibration.status !== "confirmed") warnings.push("Demo alignment is not a measured fit guarantee.");
  return encodePng(canvas, warnings);
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new CaptureError("capture_cancelled", "Capture was cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new CaptureError("capture_cancelled", "Capture was cancelled or exceeded its rendering deadline"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Frozen furniture, existing static splat and a temporary target on the existing camera/device. */
export async function capturePlayCanvasScene(runtime: PlayCanvasRuntime, job: CaptureJob, externalSignal?: AbortSignal): Promise<CaptureResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  externalSignal?.addEventListener("abort", cancel, { once: true });
  runtime.signal.addEventListener("abort", cancel, { once: true });
  if (externalSignal?.aborted || runtime.disposed) controller.abort();
  const timeout = setTimeout(cancel, 15_000);
  const frozenRoot = new Entity("Frozen capture furniture");
  frozenRoot.enabled = false;
  const furniture: Awaited<ReturnType<typeof createFurnitureEntity>>[] = [];
  let target: RenderTarget | undefined;
  let texture: Texture | undefined;
  let restore: (() => void) | undefined;
  try {
    const room = job.snapshot.room;
    if (room.roomId !== runtime.room.roomId || room.revision !== runtime.room.revision ||
      room.scan?.geometryRevision !== runtime.room.scan?.geometryRevision || room.scan?.visualUrl !== runtime.room.scan?.visualUrl)
      throw new CaptureError("room_revision_unavailable", "The frozen capture room is not loaded in this renderer");
    if (job.view === "top") {
      if (job.representation !== "spatial_plan")
        throw new CaptureError("capture_representation_required", "Scanned-room top captures require representation spatial_plan");
      return captureSpatialPlan(job);
    }
    if (runtime.capturing) throw new CaptureError("capture_busy", "Another capture is using the renderer");
    await abortable(runtime.ready, controller.signal);
    const pose = (job.camera ?? room.scan?.defaultCamera) as FirstPersonCamera | undefined;
    if (!pose || pose.kind !== "firstPerson")
      throw new CaptureError("unsupported_camera", "Scanned-room captures require an interior first-person camera");
    runtime.app.root.addChild(frozenRoot);
    const warnings: string[] = [];
    await abortable(Promise.all(job.snapshot.instances.map(async instance => {
      const product = job.snapshot.products.find(item => item.productId === instance.productId);
      if (!product) throw new CaptureError("invalid_snapshot", `Missing product for ${instance.instanceId}`);
      const item = await createFurnitureEntity(runtime, instance, product,
        supportHeightCm(room, job.snapshot.products, job.snapshot.instances, instance.instanceId, instance.pose));
      if (controller.signal.aborted) { item.dispose(); return; }
      furniture.push(item);
      frozenRoot.addChild(item.entity);
      if (item.warning) warnings.push(`${instance.instanceId}: ${item.warning}`);
    })), controller.signal);
    if (controller.signal.aborted) throw new CaptureError("capture_cancelled", "Capture was cancelled");
    const camera = runtime.camera.camera;
    if (!camera) throw new CaptureError("render_failed", "The capture camera is unavailable");
    const saved = {
      position: runtime.camera.getPosition().clone(), rotation: runtime.camera.getRotation().clone(),
      projection: camera.projection, fov: camera.fov, aspectRatioMode: camera.aspectRatioMode,
      aspectRatio: camera.aspectRatio, horizontalFov: camera.horizontalFov, renderTarget: camera.renderTarget,
      contentEnabled: runtime.contentRoot.enabled, roomEnabled: runtime.roomRoot.enabled,
    };
    restore = () => {
      if (runtime.disposed) return;
      runtime.camera.setPosition(saved.position);
      runtime.camera.setRotation(saved.rotation);
      camera.projection = saved.projection;
      camera.fov = saved.fov;
      camera.aspectRatioMode = saved.aspectRatioMode;
      camera.aspectRatio = saved.aspectRatio;
      camera.horizontalFov = saved.horizontalFov;
      camera.renderTarget = saved.renderTarget;
      runtime.contentRoot.enabled = saved.contentEnabled;
      runtime.roomRoot.enabled = saved.roomEnabled;
      runtime.capturing = false;
      runtime.app.renderNextFrame = true;
    };
    runtime.capturing = true;
    runtime.contentRoot.enabled = false;
    runtime.roomRoot.enabled = true;
    frozenRoot.enabled = true;
    texture = new Texture(runtime.app.graphicsDevice, {
      name: `capture-${job.captureId}`, width: job.width, height: job.height,
      format: PIXELFORMAT_RGBA8, mipmaps: false,
    });
    target = new RenderTarget({ name: `capture-${job.captureId}`, colorBuffer: texture, depth: true, samples: 1 });
    camera.projection = PROJECTION_PERSPECTIVE;
    camera.aspectRatioMode = ASPECT_MANUAL;
    camera.aspectRatio = job.width / job.height;
    camera.horizontalFov = false;
    camera.renderTarget = target;
    setFirstPersonCamera(runtime.camera, pose);
    await waitForSplatFrame(runtime, 14_000, controller.signal);
    const pixels = await abortable(texture.read(0, 0, job.width, job.height, { renderTarget: target, immediate: true }), controller.signal);
    if (!(pixels instanceof Uint8Array) || pixels.length !== job.width * job.height * 4)
      throw new CaptureError("render_failed", "The renderer returned an incomplete pixel buffer");
    let varied = false;
    for (let i = 4; i < pixels.length; i += 4 * 97) {
      if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 12) { varied = true; break; }
    }
    if (!varied) throw new CaptureError("render_failed", "The capture buffer is blank or uniform");
    const canvas = document.createElement("canvas");
    canvas.width = job.width;
    canvas.height = job.height;
    const context = canvas.getContext("2d");
    if (!context) throw new CaptureError("render_failed", "The PNG encoder is unavailable");
    const image = context.createImageData(job.width, job.height);
    const stride = job.width * 4;
    for (let y = 0; y < job.height; y++) {
      const sourceY = target.flipY ? y : job.height - y - 1;
      image.data.set(pixels.subarray(sourceY * stride, (sourceY + 1) * stride), y * stride);
    }
    context.putImageData(image, 0, 0);
    if (room.scan?.calibration.status !== "confirmed") warnings.push(room.scan?.visualFormat === "glb" ? "Authored test room; dimensions do not represent a measured real room." : "Demo scan alignment is not a measured fit guarantee.");
    return encodePng(canvas, warnings);
  } catch (error) {
    return { error: { code: error instanceof CaptureError ? error.code : "render_failed", message: error instanceof Error ? error.message : "Unable to capture the room" } };
  } finally {
    controller.abort();
    clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", cancel);
    runtime.signal.removeEventListener("abort", cancel);
    restore?.();
    for (const item of furniture) item.dispose();
    frozenRoot.destroy();
    target?.destroy();
    texture?.destroy();
  }
}
