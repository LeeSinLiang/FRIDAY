import * as pc from "playcanvas";
import type { Instance, Product, Room } from "../types";
import { cmToScene, sceneToCm } from "../units";
import { validatePlacement } from "../placement";

export type NavigationMode = "explore" | "walk" | "place";
export type NavigationState = { room: Room; mode: NavigationMode; view: "perspective" | "top"; instances?: Instance[]; products?: Product[] };
export type NavigationRuntime = {
  app: pc.Application;
  camera: pc.Entity;
  capturing: boolean;
  disposed: boolean;
};

export const isTextEntry = (target: EventTarget | null) => target instanceof HTMLElement &&
  (!!target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']"));

const WALK_SPEED_CM_PER_SECOND = 240;
const FAST_WALK_SPEED_CM_PER_SECOND = 360;

/** A short frame cap prevents a background-tab resume from jumping across the room. */
export function movementDelta(dt: number, speedCm = WALK_SPEED_CM_PER_SECOND): number {
  return Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, 0.05)) * speedCm;
}

export function canWalkAt(room: Room, xCm: number, zCm: number, halfWidthCm = 20): boolean {
  const camera: Product = { productId: "__camera_clearance__", name: "Camera", kind: "chair", color: "#ffffff",
    widthCm: halfWidthCm * 2, depthCm: halfWidthCm * 2, heightCm: 1 };
  const pose = { xCm, zCm, yawRad: 0 };
  // Share the exact reviewed-area union and SAT checks with placement. This 40 cm square
  // matches the backend capture camera contract, including seams and unknown floor gaps.
  return validatePlacement(room, [camera], [{ instanceId: "__camera__", productId: camera.productId, pose }], "__camera__", pose).valid;
}

/** Small swept steps and independent axes keep walking from tunnelling through a thin obstacle. */
export function advanceWalk(room: Room, position: { xCm: number; zCm: number }, dx: number, dz: number) {
  let { xCm, zCm } = position;
  if (![dx, dz].every(Number.isFinite)) return { xCm, zCm };
  const length = Math.hypot(dx, dz);
  if (length > 100) { dx *= 100 / length; dz *= 100 / length; }
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 4));
  for (let step = 0; step < steps; step++) {
    if (canWalkAt(room, xCm + dx / steps, zCm)) xCm += dx / steps;
    if (canWalkAt(room, xCm, zCm + dz / steps)) zCm += dz / steps;
  }
  return { xCm, zCm };
}

/** Camera pose lives in PlayCanvas; React receives only deliberate editor actions. */
export function createNavigation(runtime: NavigationRuntime, initial: NavigationState, suspended: () => boolean) {
  let state = initial;
  let disposed = false;
  let look: { x: number; y: number } | null = null;
  const camera = runtime.camera;
  const startPosition = camera.getPosition().clone();
  const startRotation = camera.getRotation().clone();
  let perspectivePosition = startPosition.clone();
  let perspectiveRotation = startRotation.clone();
  let deferredState: NavigationState | null = null;
  let deferredReset = false;
  const keys = new Set<string>();
  const yawPitch = () => {
    const forward = camera.forward;
    return { yaw: Math.atan2(-forward.x, -forward.z), pitch: Math.asin(Math.max(-1, Math.min(1, forward.y))) };
  };
  const blocked = () => disposed || runtime.disposed || runtime.capturing || suspended() ||
    state.view === "top" || state.mode === "place" || isTextEntry(document.activeElement);
  const stop = () => { keys.clear(); look = null; };
  const turn = (dx: number, dy: number) => {
    const { yaw, pitch } = yawPitch();
    const nextPitch = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, pitch - dy * 0.003));
    camera.setEulerAngles(nextPitch * pc.math.RAD_TO_DEG, (yaw - dx * 0.003) * pc.math.RAD_TO_DEG, 0);
  };
  const setView = () => {
    const component = camera.camera!;
    if (state.view === "top") {
      const canvas = runtime.app.graphicsDevice.canvas;
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      component.projection = pc.PROJECTION_ORTHOGRAPHIC;
      component.orthoHeight = cmToScene(Math.max(state.room.depthCm, state.room.widthCm / aspect) * 0.57);
      camera.setPosition(cmToScene(state.room.widthCm / 2), cmToScene(state.room.heightCm + 250), cmToScene(state.room.depthCm / 2));
      camera.setEulerAngles(-90, 0, 0);
    } else {
      component.projection = pc.PROJECTION_PERSPECTIVE;
      camera.setPosition(perspectivePosition);
      camera.setRotation(perspectiveRotation);
    }
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") { stop(); return; }
    if (blocked() || state.mode !== "walk" || event.metaKey || event.ctrlKey || event.altKey) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight"].includes(event.code)) {
      event.preventDefault(); keys.add(event.code);
    }
  };
  const keyup = (event: KeyboardEvent) => { keys.delete(event.code); };
  const focus = (event: FocusEvent) => { if (isTextEntry(event.target)) stop(); };
  const visibility = () => { if (document.hidden) stop(); };
  const update = (next: NavigationState) => {
    if (runtime.capturing) { deferredState = next; stop(); return; }
    if (next.mode !== state.mode) stop();
    if (next.view !== state.view) {
      stop();
      if (state.view === "perspective") { perspectivePosition = camera.getPosition().clone(); perspectiveRotation = camera.getRotation().clone(); }
      state = next; setView();
    } else state = next;
  };
  const frame = (dt: number) => {
    if (!runtime.capturing && deferredState) { const next = deferredState; deferredState = null; update(next); }
    if (!runtime.capturing && deferredReset) {
      deferredReset = false; perspectivePosition = startPosition.clone(); perspectiveRotation = startRotation.clone(); setView();
    }
    if (!runtime.capturing && state.view === "top") {
      const canvas = runtime.app.graphicsDevice.canvas;
      const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
      camera.camera!.orthoHeight = cmToScene(Math.max(state.room.depthCm, state.room.widthCm / aspect) * 0.57);
    }
    if (blocked() || state.mode !== "walk") { keys.clear(); return; }
    const forward = Number(keys.has("KeyW") || keys.has("ArrowUp")) - Number(keys.has("KeyS") || keys.has("ArrowDown"));
    const right = Number(keys.has("KeyD") || keys.has("ArrowRight")) - Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    if (!forward && !right) return;
    const { yaw } = yawPitch();
    const step = movementDelta(dt, keys.has("ShiftLeft") || keys.has("ShiftRight") ? FAST_WALK_SPEED_CM_PER_SECOND : WALK_SPEED_CM_PER_SECOND) / Math.hypot(forward, right);
    const current = camera.getPosition();
    const placedObstacles = (state.instances ?? []).flatMap(instance => {
      const product = state.products?.find(item => item.productId === instance.productId);
      return product ? [{ obstacleId: instance.instanceId, label: product.name, ...instance.pose, widthCm: product.widthCm, depthCm: product.depthCm }] : [];
    });
    const walkRoom = { ...state.room, spatial: { freeAreas: state.room.spatial?.freeAreas ?? [], obstacles: [...(state.room.spatial?.obstacles ?? []), ...placedObstacles] } };
    const next = advanceWalk(walkRoom, { xCm: sceneToCm(current.x), zCm: sceneToCm(current.z) },
      (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * step,
      (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * step);
    camera.setPosition(cmToScene(next.xCm), current.y, cmToScene(next.zCm));
  };
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", stop);
  document.addEventListener("focusin", focus);
  document.addEventListener("visibilitychange", visibility);
  runtime.app.on("update", frame);
  if (state.view === "top") setView();
  return {
    beginLook(x: number, y: number) { if (!blocked()) look = { x, y }; },
    moveLook(x: number, y: number) {
      if (!look || blocked()) return;
      turn(x - look.x, y - look.y);
      look = { x, y };
    },
    moveLookDelta(dx: number, dy: number) { if (!blocked() && state.mode === "walk") turn(dx, dy); },
    stop,
    update,
    reset() {
      stop();
      if (runtime.capturing) { deferredReset = true; return; }
      perspectivePosition = startPosition.clone(); perspectiveRotation = startRotation.clone(); setView();
    },
    dispose() {
      disposed = true; stop(); runtime.app.off("update", frame);
      window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", stop); document.removeEventListener("focusin", focus);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
