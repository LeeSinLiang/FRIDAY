import { useCallback, useEffect, useRef } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { Group, Plane, Raycaster, Vector2, Vector3 } from "three";
import type { Instance, Pose } from "./types";
import { cmToScene, sceneToCm, SCENE_UNIT_CM } from "./units";

type Options = {
  instances: Instance[];
  snap: boolean;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, pose: Pose) => void;
  onActiveChange: (active: boolean) => void;
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
};
const floor = new Plane(new Vector3(0, 1, 0), 0);

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
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      pointer.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        (-(clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.current.setFromCamera(pointer.current, camera);
      // A near-parallel ray can yield enormous, unstable floor positions.
      if (Math.abs(raycaster.current.ray.direction.y) < 0.0001) return null;
      return raycaster.current.ray.intersectPlane(floor, intersection.current);
    },
    [camera, gl],
  );
  const finish = useCallback(
    (commit: boolean) => {
      const drag = active.current;
      if (!drag) return;
      active.current = null;
      if (!commit)
        drag.group.position.set(
          cmToScene(drag.initial.xCm),
          0,
          cmToScene(drag.initial.zCm),
        );
      if (gl.domElement.hasPointerCapture(drag.pointerId))
        gl.domElement.releasePointerCapture(drag.pointerId);
      latest.current.onActiveChange(false);
      if (
        commit &&
        latest.current.instances.some((i) => i.instanceId === drag.id)
      )
        latest.current.onCommit(drag.id, drag.preview);
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
      const point = project(event.clientX, event.clientY);
      if (!point) return;
      let xCm = sceneToCm(point.x - drag.offset.x);
      let zCm = sceneToCm(point.z - drag.offset.z);
      if (latest.current.snap) {
        xCm = Math.round(xCm / SCENE_UNIT_CM) * SCENE_UNIT_CM;
        zCm = Math.round(zCm / SCENE_UNIT_CM) * SCENE_UNIT_CM;
      }
      if (!Number.isFinite(xCm) || !Number.isFinite(zCm)) return;
      drag.preview = { xCm, zCm, yawRad: drag.initial.yawRad };
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
      if (event.button !== 0 || !event.isPrimary || active.current) return;
      event.stopPropagation();
      suppressClick.current = true;
      latest.current.onSelect(instance.instanceId);
      const group = groups.current.get(instance.instanceId);
      const point = project(event.clientX, event.clientY);
      if (!group || !point) return;
      // Orbit may have observed native pointerdown before R3F dispatches it.
      // Cancel that native gesture before taking ownership; otherwise Escape
      // could resume an old orbit when controls become enabled again.
      latest.current.onActiveChange(true);
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
      gl.domElement.setPointerCapture(event.pointerId);
    },
  });
  return { bind, cancel };
}
