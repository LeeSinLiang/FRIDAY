import { useCallback, useEffect, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Group, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Instance, Pose, Product, Room } from "./types";
import { cmToScene, sceneToCm, SCENE_UNIT_CM } from "./units";
import { validatePlacement } from "./placement";

export type PlacementPreview = {
  instanceId: string;
  pose: Pose;
  valid: boolean;
  reason: string;
};

type Options = {
  enabled?: boolean;
  room: Room;
  products: Product[];
  instances: Instance[];
  snap: boolean;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, pose: Pose) => void;
  onActiveChange: (active: boolean) => void;
  onPreview?: (preview: PlacementPreview | null) => void;
};
type Drag = {
  id: string;
  pointerId: number;
  group: Group;
  initial: Pose;
  preview: Pose;
  offset: Vector3;
  startX: number;
  startY: number;
  moved: boolean;
  plane: Plane;
  valid: boolean;
  reason: string;
};

export function useFurnitureDrag(options: Options) {
  const { gl, camera, invalidate } = useThree();
  const latest = useRef(options);
  latest.current = options;
  const groups = useRef(new Map<string, Group>());
  const active = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const raycaster = useRef(new Raycaster());
  const pointer = useRef(new Vector2());
  const intersection = useRef(new Vector3());
  const project = useCallback(
    (clientX: number, clientY: number, plane: Plane) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
      // Keep the grabbed surface under the pointer rather than projecting a
      // sofa's top onto the floor, which makes it slide away from the cursor.
      if (Math.abs(raycaster.current.ray.direction.y) < 0.0001) return null;
      return raycaster.current.ray.intersectPlane(plane, intersection.current);
    },
    [camera, gl],
  );
  const finish = useCallback(
    (commit: boolean) => {
      const drag = active.current;
      if (!drag) return;
      active.current = null;
      const current = latest.current;
      const exists = current.instances.some((i) => i.instanceId === drag.id);
      const result = validatePlacement(current.room, current.products, current.instances, drag.id, drag.preview);
      const shouldCommit = commit && drag.moved && exists && result.valid;
      if (!shouldCommit)
        drag.group.position.set(
          cmToScene(drag.initial.xCm),
          0,
          cmToScene(drag.initial.zCm),
        );
      delete drag.group.userData.placementValid;
      delete drag.group.userData.placementReason;
      delete drag.group.userData.placementDragging;
      gl.domElement.style.cursor = "";
      if (commit && drag.moved && !result.valid)
        current.onPreview?.({ instanceId: drag.id, pose: drag.preview, valid: false, reason: result.reason });
      if (gl.domElement.hasPointerCapture(drag.pointerId)) {
        try { gl.domElement.releasePointerCapture(drag.pointerId); } catch { /* Pointer already ended outside the document. */ }
      }
      gl.domElement.dispatchEvent(new CustomEvent("friday-drag", { detail: false }));
      current.onActiveChange(false);
      if (shouldCommit) current.onCommit(drag.id, drag.preview);
      current.onPreview?.(null);
      invalidate();
    },
    [gl, invalidate],
  );
  const cancel = useCallback(() => finish(false), [finish]);

  useEffect(() => {
    const preview = (event: PointerEvent) => {
      const drag = active.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (
        !drag.moved &&
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 3
      )
        return;
      drag.moved = true;
      const point = project(event.clientX, event.clientY, drag.plane);
      if (!point) return;
      let xCm = sceneToCm(point.x - drag.offset.x);
      let zCm = sceneToCm(point.z - drag.offset.z);
      if (latest.current.snap) {
        xCm = Math.round(xCm / SCENE_UNIT_CM) * SCENE_UNIT_CM;
        zCm = Math.round(zCm / SCENE_UNIT_CM) * SCENE_UNIT_CM;
      }
      if (!Number.isFinite(xCm) || !Number.isFinite(zCm)) return;
      drag.preview = { xCm, zCm, yawRad: drag.initial.yawRad };
      const current = latest.current;
      const result = validatePlacement(current.room, current.products, current.instances, drag.id, drag.preview);
      drag.group.userData.placementValid = result.valid;
      drag.group.userData.placementReason = result.reason;
      if (result.valid !== drag.valid || result.reason !== drag.reason) {
        drag.valid = result.valid;
        drag.reason = result.reason;
        current.onPreview?.({ instanceId: drag.id, pose: drag.preview, valid: result.valid, reason: result.reason });
      }
      drag.group.position.set(cmToScene(xCm), 0, cmToScene(zCm));
      invalidate();
    };
    const move = (event: PointerEvent) => {
      if (active.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      preview(event);
    };
    const up = (event: PointerEvent) => {
      if (active.current?.pointerId !== event.pointerId) return;
      preview(event);
      finish(true);
    };
    const cancelled = (event: PointerEvent) => {
      if (active.current?.pointerId === event.pointerId) cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && active.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
        cancel();
      }
    };
    // R3F click raycasts include the floor behind furniture even though pointerdown
    // stopped propagation. Consume only the click belonging to this gesture.
    const down = () => {
      if (!active.current) suppressClick.current = false;
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    gl.domElement.addEventListener("pointerdown", down, true);
    gl.domElement.addEventListener("click", click, true);
    window.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancelled, true);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    gl.domElement.addEventListener("lostpointercapture", cancelled);
    return () => {
      gl.domElement.removeEventListener("pointerdown", down, true);
      gl.domElement.removeEventListener("click", click, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancelled, true);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      gl.domElement.removeEventListener("lostpointercapture", cancelled);
      cancel();
    };
  }, [cancel, finish, gl, invalidate, project]);
  useEffect(() => {
    if (
      active.current &&
      !options.instances.some((i) => i.instanceId === active.current!.id)
    )
      cancel();
  }, [options.instances, cancel]);

  const bind = (instance: Instance) => ({
    groupRef: (node: Group | null) => {
      if (node) groups.current.set(instance.instanceId, node);
      else groups.current.delete(instance.instanceId);
    },
    onPointerDown: (event: ThreeEvent<PointerEvent>) => {
      if (latest.current.enabled === false || event.button !== 0 || !event.isPrimary || active.current) return;
      event.stopPropagation();
      suppressClick.current = true;
      latest.current.onSelect(instance.instanceId);
      const group = groups.current.get(instance.instanceId);
      if (!group || !Number.isFinite(event.point.y)) return;
      const point = event.point.clone();
      const plane = new Plane(new Vector3(0, 1, 0), -point.y);
      const current = latest.current;
      const result = validatePlacement(current.room, current.products, current.instances, instance.instanceId, instance.pose);
      // Orbit may have observed native pointerdown before R3F dispatches it.
      // Cancel that native gesture before taking ownership; otherwise Escape
      // could resume an old orbit when controls become enabled again.
      gl.domElement.dispatchEvent(new CustomEvent("friday-drag", { detail: true }));
      current.onActiveChange(true);
      gl.domElement.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: event.pointerId,
          pointerType: event.pointerType,
        }),
      );
      active.current = {
        id: instance.instanceId,
        pointerId: event.pointerId,
        group,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        plane,
        valid: result.valid,
        reason: result.reason,
        initial: { ...instance.pose },
        preview: { ...instance.pose },
        offset: point
          .clone()
          .sub(
            new Vector3(
              cmToScene(instance.pose.xCm),
              0,
              cmToScene(instance.pose.zCm),
            ),
          ),
      };
      group.userData.placementDragging = true;
      group.userData.placementValid = result.valid;
      group.userData.placementReason = result.reason;
      gl.domElement.style.cursor = "grabbing";
      current.onPreview?.({ instanceId: instance.instanceId, pose: instance.pose, valid: result.valid, reason: result.reason });
      try { gl.domElement.setPointerCapture(event.pointerId); } catch { cancel(); }
      invalidate();
    },
  });
  return { bind, cancel };
}
