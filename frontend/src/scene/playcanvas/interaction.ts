import { createAngelMovers } from "./angelMovers";
import { planAngelMove, type AgentMotion } from "./angelMotion";
import * as pc from "playcanvas";
import type { Instance, Pose, Product } from "../types";
import { validatePlacement } from "../placement";
import { sceneToCm } from "../units";
import { createFurnitureLayer } from "./furniture";
import { createNavigation, isTextEntry } from "./navigation";
import { createPlacementOverlays } from "./overlays";
import { createSurfaceReference } from "./surface";
import type { InteractionCallbacks, InteractionState, PlacementPreview } from "./contracts";
import type { PlayCanvasRuntime } from "./runtime";

type Point = { x: number; y: number; z: number };
export type SceneRay = { origin: Point; direction: Point };

export function intersectFloor(ray: SceneRay, heightCm = 0, maxDistanceCm = 3000): Point | null {
  if (Math.abs(ray.direction.y) < 0.00001) return null;
  const distance = (heightCm - ray.origin.y) / ray.direction.y;
  if (!Number.isFinite(distance) || distance < 0 || distance > maxDistanceCm) return null;
  return { x: ray.origin.x + ray.direction.x * distance, y: heightCm, z: ray.origin.z + ray.direction.z * distance };
}

/** Oriented catalogue bounds give stable hit targets even while the GLB is loading. */
export function furnitureHit(ray: SceneRay, instance: Instance, product: Product): { distance: number; point: Point } | null {
  const c = Math.cos(instance.pose.yawRad), s = Math.sin(instance.pose.yawRad);
  const dx = ray.origin.x - instance.pose.xCm, dz = ray.origin.z - instance.pose.zCm;
  const origin = [c * dx - s * dz, ray.origin.y, s * dx + c * dz];
  const direction = [c * ray.direction.x - s * ray.direction.z, ray.direction.y, s * ray.direction.x + c * ray.direction.z];
  const lower = [-product.widthCm / 2, 0, -product.depthCm / 2];
  const upper = [product.widthCm / 2, product.heightCm, product.depthCm / 2];
  let near = 0, far = Infinity;
  for (let axis = 0; axis < 3; axis++) {
    if (Math.abs(direction[axis]) < 0.000001) { if (origin[axis] < lower[axis] || origin[axis] > upper[axis]) return null; continue; }
    const a = (lower[axis] - origin[axis]) / direction[axis];
    const b = (upper[axis] - origin[axis]) / direction[axis];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
    if (near > far) return null;
  }
  if (!Number.isFinite(near) || far < 0) return null;
  return { distance: near, point: { x: ray.origin.x + ray.direction.x * near, y: ray.origin.y + ray.direction.y * near, z: ray.origin.z + ray.direction.z * near } };
}

export const PLACEMENT_STEP_CM = 5;
export function dragPose(point: Point, offset: { x: number; z: number }, yawRad: number, snap: boolean): Pose {
  let xCm = point.x - offset.x, zCm = point.z - offset.z;
  if (snap) { xCm = Math.round(xCm / PLACEMENT_STEP_CM) * PLACEMENT_STEP_CM; zCm = Math.round(zCm / PLACEMENT_STEP_CM) * PLACEMENT_STEP_CM; }
  return { xCm, zCm, yawRad };
}

type Gesture =
  | { kind: "look"; pointerId: number; x: number; y: number; moved: boolean; hitId: string | null }
  | { kind: "pending"; pointerId: number; x: number; y: number; moved: boolean }
  | { kind: "drag"; pointerId: number; x: number; y: number; moved: boolean; instanceId: string; initial: Pose; pose: Pose; heightCm: number; offset: { x: number; z: number } };

/** Owns only transient previews. Accepted edits and history remain with the application. */
export function createSceneInteraction(runtime: PlayCanvasRuntime, initial: InteractionState, callbacks: InteractionCallbacks) {
  let state = initial;
  let pendingMotion: AgentMotion | null = null;
  let disposed = false;
  let gesture: Gesture | null = null;
  let ghost: Instance | null = null;
  let ghostHasFloor = false;
  let preview: PlacementPreview | null = null;
  let busy = false;
  let pendingEdit: { instanceId: string; pose: Pose } | null = null;
  let token = 0;
  let activeReported = false;
  let previewKey = "";
  const canvas = runtime.canvas;
  const originalTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = "none";
  const furniture = createFurnitureLayer(runtime, runtime.contentRoot, (id, status) => {
    if (id !== ghost?.instanceId) callbacks.onModelStatus(id, status);
  });
  const angels = createAngelMovers(runtime, (id, pose) => furniture.preview(id, pose));
  const overlays = createPlacementOverlays(runtime, runtime.contentRoot);
  const surface = createSurfaceReference(runtime, callbacks.onSurfaceStatus);
  const navigation = createNavigation(runtime, initial, () => busy || !!gesture && gesture.kind !== "look" || !!state.pendingProductId);
  const unavailable = () => disposed || runtime.disposed || runtime.capturing || busy;
  const productFor = (id: string) => state.products.find(product => product.productId === id);
  const reportActive = (active: boolean) => {
    if (active !== activeReported) { activeReported = active; callbacks.onActiveChange(active); }
  };
  const reportPreview = (value: PlacementPreview | null, force = false) => {
    preview = value;
    // Positions stay on the graphics thread; React updates only when the explanation changes.
    const key = value ? `${value.instanceId}:${value.valid}:${value.reason}:${value.assurance}` : "";
    if (force || key !== previewKey) { previewKey = key; callbacks.onPreview(value); }
    const item = ghost ?? state.instances.find(instance => instance.instanceId === (value?.instanceId ?? state.selectedId));
    overlays.update(state.room, item ? productFor(item.productId) ?? null : null, value, state.view);
  };
  const rayAt = (clientX: number, clientY: number): SceneRay | null => {
    const rect = canvas.getBoundingClientRect();
    const camera = runtime.camera.camera;
    if (!camera || !rect.width || !rect.height) return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    const near = camera.screenToWorld(x, y, camera.nearClip);
    const far = camera.screenToWorld(x, y, camera.farClip);
    const direction = new pc.Vec3().sub2(far, near).normalize();
    return { origin: { x: sceneToCm(near.x), y: sceneToCm(near.y), z: sceneToCm(near.z) }, direction };
  };
  const floorAt = (x: number, y: number, heightCm = 0) => {
    const ray = rayAt(x, y); return ray ? intersectFloor(ray, heightCm, Math.max(3000, Math.hypot(state.room.widthCm, state.room.depthCm) * 2)) : null;
  };
  const hitAt = (x: number, y: number) => {
    const ray = rayAt(x, y); if (!ray) return null;
    let closest: { instance: Instance; point: Point; distance: number } | null = null;
    for (const instance of state.instances) {
      const product = productFor(instance.productId); if (!product) continue;
      const hit = furnitureHit(ray, instance, product);
      if (hit && (!closest || hit.distance < closest.distance)) closest = { instance, ...hit };
    }
    return closest;
  };
  const validate = (instance: Instance, pose: Pose): PlacementPreview => ({
    instanceId: instance.instanceId, pose,
    ...validatePlacement(state.room, state.products, ghost?.instanceId === instance.instanceId ? [...state.instances, instance] : state.instances, instance.instanceId, pose),
  });
  const syncFurniture = (movingId?: string) => {
    furniture.sync(ghost ? [...state.instances, ghost] : state.instances, state.products, state.retries, movingId ?? pendingEdit?.instanceId);
    if (pendingEdit) furniture.preview(pendingEdit.instanceId, pendingEdit.pose);
    if (ghost && !ghostHasFloor) furniture.setVisible(ghost.instanceId, false);
  };
  const selectedPreview = () => {
    const instance = state.instances.find(item => item.instanceId === state.selectedId);
    reportPreview(instance ? validate(instance, instance.pose) : null);
  };
  const release = (pointerId: number) => {
    if (canvas.hasPointerCapture(pointerId)) { try { canvas.releasePointerCapture(pointerId); } catch { /* The browser may already have cancelled the pointer. */ } }
  };
  const cancelGesture = () => {
    const current = gesture; gesture = null;
    navigation.stop(); canvas.style.cursor = "";
    if (current) release(current.pointerId);
    if (!busy) { syncFurniture(); reportActive(false); if (!ghost) selectedPreview(); }
  };
  const updateGhost = (x: number, y: number) => {
    if (!ghost || unavailable() || !state.editingEnabled) return;
    const point = floorAt(x, y);
    ghostHasFloor = !!point;
    if (!point) {
      furniture.setVisible(ghost.instanceId, false);
      reportPreview({ instanceId: ghost.instanceId, pose: ghost.pose, valid: false, reason: "Point at the floor to place furniture", collidingIds: [] });
      return;
    }
    ghost.pose = dragPose(point, { x: 0, z: 0 }, ghost.pose.yawRad, state.snap);
    furniture.setVisible(ghost.instanceId, true);
    furniture.preview(ghost.instanceId, ghost.pose);
    reportPreview(validate(ghost, ghost.pose));
  };
  const updateDrag = (event: PointerEvent, current: Extract<Gesture, { kind: "drag" }>) => {
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 4) return;
    current.moved = true;
    const point = floorAt(event.clientX, event.clientY, current.heightCm);
    if (!point) return;
    current.pose = dragPose(point, current.offset, current.initial.yawRad, state.snap);
    const instance = state.instances.find(item => item.instanceId === current.instanceId);
    if (!instance) { cancelGesture(); return; }
    furniture.preview(current.instanceId, current.pose);
    reportPreview(validate(instance, current.pose));
  };
  const confirm = async (instance: Instance, pose: Pose, pending: boolean) => {
    if (pending && !ghostHasFloor) return;
    const result = validate(instance, pose); reportPreview(result, true);
    if (!result.valid || unavailable() || !state.editingEnabled) return;
    busy = true; pendingEdit = { instanceId: instance.instanceId, pose }; reportActive(true); navigation.stop(); canvas.style.cursor = "progress";
    const request = ++token;
    try {
      const accepted = pending ? await callbacks.onPlace(instance.productId, pose) : await callbacks.onCommit(instance.instanceId, pose);
      if (disposed || request !== token) return;
      // onPlace owns accepted application state. Cancellation is only an explicit user action.
      if (accepted && pending) ghost = null;
      if (!accepted) reportPreview({ ...result, valid: false, reason: "Placement was not accepted. Review the latest room and try again." }, true);
    } catch (error) {
      if (!disposed && request === token) reportPreview({ ...result, valid: false, reason: error instanceof Error ? error.message : "Placement could not be saved" }, true);
    } finally {
      if (!disposed && request === token) {
        busy = false; pendingEdit = null; canvas.style.cursor = ""; reportActive(false); syncFurniture();
        if (!ghost) selectedPreview();
      }
    }
  };
  const down = (event: PointerEvent) => {
    if (unavailable() || event.button !== 0 || !event.isPrimary || gesture) return;
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    if (state.mode === "walk" && document.pointerLockElement === canvas) {
      const rect = canvas.getBoundingClientRect();
      const hit = hitAt(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit) callbacks.onSelect(hit.instance.instanceId);
      return;
    }
    if (ghost && state.editingEnabled) {
      updateGhost(event.clientX, event.clientY);
      gesture = { kind: "pending", pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    } else {
      const hit = hitAt(event.clientX, event.clientY);
      if (state.mode === "walk" && !hit) void canvas.requestPointerLock().catch(() => { /* Keep drag-look when pointer lock is unavailable. */ });
      if (state.mode === "place" && state.editingEnabled) {
        if (!hit) { callbacks.onSelect(null); return; }
        callbacks.onSelect(hit.instance.instanceId);
        gesture = { kind: "drag", pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
          instanceId: hit.instance.instanceId, initial: { ...hit.instance.pose }, pose: { ...hit.instance.pose }, heightCm: hit.point.y,
          offset: { x: hit.point.x - hit.instance.pose.xCm, z: hit.point.z - hit.instance.pose.zCm } };
        navigation.stop(); reportActive(true); reportPreview(validate(hit.instance, hit.instance.pose), true); canvas.style.cursor = "grabbing";
      } else if (state.mode !== "place") {
        gesture = { kind: "look", pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false, hitId: hit?.instance.instanceId ?? null };
        navigation.beginLook(event.clientX, event.clientY); canvas.style.cursor = "grabbing";
      }
    }
    if (gesture) { try { canvas.setPointerCapture(event.pointerId); } catch { cancelGesture(); } }
  };
  const move = (event: PointerEvent) => {
    if (unavailable()) return;
    if (state.mode === "walk" && document.pointerLockElement === canvas) {
      navigation.moveLookDelta(event.movementX, event.movementY);
      return;
    }
    if (!gesture) {
      if (event.target === canvas) {
        if (ghost) updateGhost(event.clientX, event.clientY);
        else canvas.style.cursor = hitAt(event.clientX, event.clientY) ? "grab" : state.mode === "place" ? "default" : "grab";
      }
      return;
    }
    if (event.pointerId !== gesture.pointerId) return;
    event.preventDefault();
    if (gesture.kind === "drag") updateDrag(event, gesture);
    else {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) >= 4) gesture.moved = true;
      if (gesture.kind === "look") navigation.moveLook(event.clientX, event.clientY);
      else updateGhost(event.clientX, event.clientY);
    }
  };
  const up = (event: PointerEvent) => {
    const current = gesture;
    if (!current || current.pointerId !== event.pointerId) return;
    if (unavailable()) { cancelGesture(); return; }
    if (current.kind === "drag") updateDrag(event, current);
    gesture = null; navigation.stop(); release(event.pointerId); canvas.style.cursor = "";
    if (current.kind === "look") {
      if (!current.moved && (current.hitId || state.mode !== "walk")) callbacks.onSelect(current.hitId);
    }
    else if (current.kind === "pending") {
      if (!current.moved && ghost) void confirm(ghost, ghost.pose, true);
    } else {
      const instance = state.instances.find(item => item.instanceId === current.instanceId);
      if (current.moved && instance) void confirm(instance, current.pose, false);
      if (!busy) { syncFurniture(); reportActive(false); }
    }
  };
  const cancel = () => { cancelGesture(); if (ghost && !busy) { ghost = null; callbacks.onCancelPlacement(); syncFurniture(); selectedPreview(); } };
  const pointerCancel = (event: PointerEvent) => { if (gesture?.pointerId === event.pointerId) cancelGesture(); };
  const lockChange = () => { canvas.style.cursor = document.pointerLockElement === canvas ? "none" : ""; };
  const key = (event: KeyboardEvent) => {
    if (event.key === "Escape") { cancel(); return; }
    if (unavailable() || isTextEntry(event.target) || !ghost || !state.editingEnabled) return;
    if (event.code === "KeyR") {
      event.preventDefault(); ghost.pose = { ...ghost.pose, yawRad: ghost.pose.yawRad + Math.PI / 2 };
      furniture.preview(ghost.instanceId, ghost.pose); if (ghostHasFloor) reportPreview(validate(ghost, ghost.pose));
    }
  };
  const focus = (event: FocusEvent) => { if (isTextEntry(event.target)) cancelGesture(); };
  const visibility = () => { if (document.hidden) cancel(); };
  const frame = (dt: number) => {
    if (runtime.capturing) { if (gesture) cancelGesture(); return; }
    runtime.roomRoot.enabled = state.view !== "top";
    if (pendingMotion && !busy && !ghost && (!gesture || gesture.kind === "look")) {
      const cameraPosition = runtime.camera.getPosition();
      const motion = planAngelMove(pendingMotion, state.room, state.products, state.instances,
        {xCm:sceneToCm(cameraPosition.x),zCm:sceneToCm(cameraPosition.z)});
      pendingMotion = null;
      if (motion && state.view !== "top") angels.start(motion);
    }
    angels.update(dt, state.view !== "top" && !ghost && (!gesture || gesture.kind === "look") && !busy);
  };
  runtime.app.on("update", frame);
  canvas.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", pointerCancel);
  canvas.addEventListener("lostpointercapture", pointerCancel);
  document.addEventListener("pointerlockchange", lockChange);
  window.addEventListener("keydown", key);
  window.addEventListener("blur", cancel);
  document.addEventListener("focusin", focus);
  document.addEventListener("visibilitychange", visibility);

  const update = (next: InteractionState) => {
    const prior = state;
    state = next;
    if (JSON.stringify(next.instances) !== JSON.stringify(prior.instances)) angels.stop();
    const activeGesture = gesture;
    const activeInstance = activeGesture?.kind === "drag" ? next.instances.find(item => item.instanceId === activeGesture.instanceId) : null;
    if (gesture && (next.mode !== prior.mode || next.view !== prior.view || !next.editingEnabled ||
      gesture.kind === "drag" && (!activeInstance || JSON.stringify(activeInstance.pose) !== JSON.stringify(gesture.initial)))) cancelGesture();
    navigation.update(next);
    if (next.mode !== "walk" && document.pointerLockElement === canvas) document.exitPointerLock();
    if (!runtime.capturing) runtime.roomRoot.enabled = next.view !== "top";
    surface.update(next.room, !!next.showSurface && next.view !== "top");
    if (next.pendingProductId !== prior.pendingProductId || !ghost && next.pendingProductId && !busy) {
      ghost = null;
      ghostHasFloor = false;
      if (next.pendingProductId && productFor(next.pendingProductId)) {
        let id = "__pending_furniture__";
        while (next.instances.some(instance => instance.instanceId === id)) id += "_";
        ghost = { instanceId: id, productId: next.pendingProductId, pose: { xCm: next.room.widthCm / 2, zCm: next.room.depthCm / 2, yawRad: 0 } };
      }
      syncFurniture();
      if (ghost) { const rect = canvas.getBoundingClientRect(); updateGhost(rect.left + rect.width / 2, rect.top + rect.height * 0.66); }
    } else syncFurniture(gesture?.kind === "drag" ? gesture.instanceId : undefined);
    if (next.agentMotion?.revision !== prior.agentMotion?.revision) pendingMotion = next.agentMotion ?? null;
    if (ghost && ghostHasFloor) reportPreview(validate(ghost, ghost.pose));
    else if (ghost) reportPreview({ instanceId: ghost.instanceId, pose: ghost.pose, valid: false, reason: "Point at the floor to place furniture", collidingIds: [] });
    else if (gesture?.kind === "drag") {
      const current = gesture;
      const instance = state.instances.find(item => item.instanceId === current.instanceId);
      if (instance) reportPreview(validate(instance, current.pose));
    } else if (!busy) selectedPreview();
    else if (preview) overlays.update(state.room, productFor(state.instances.find(item => item.instanceId === preview!.instanceId)?.productId ?? "") ?? null, preview, state.view);
  };
  // Force the initial pending product through the same path as subsequent catalogue picks.
  state = { ...initial, pendingProductId: null }; update(initial);
  return {
    update,
    resetView() { cancelGesture(); navigation.reset(); },
    dispose() {
      if (disposed) return;
      cancelGesture(); disposed = true; token++;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      runtime.app.off("update", frame);
      navigation.dispose(); overlays.dispose(); surface.dispose(); angels.dispose(); furniture.dispose();
      canvas.style.cursor = ""; canvas.style.touchAction = originalTouchAction;
      canvas.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", pointerCancel);
      canvas.removeEventListener("lostpointercapture", pointerCancel); window.removeEventListener("keydown", key);
      document.removeEventListener("pointerlockchange", lockChange);
      window.removeEventListener("blur", cancel); document.removeEventListener("focusin", focus);
      document.removeEventListener("visibilitychange", visibility); reportActive(false);
    },
  };
}
