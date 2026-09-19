import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CameraMode, Room } from "./types";
import { cmToScene } from "./units";

export default function SceneControls({
  room,
  mode,
  interactionActive,
  resetKey,
}: {
  room: Room;
  mode: CameraMode;
  interactionActive: boolean;
  resetKey: number;
}) {
  const { gl, set, size, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  const w = cmToScene(room.widthCm);
  const d = cmToScene(room.depthCm);
  const h = cmToScene(room.heightCm);
  const span = Math.max(w, d);
  const perspective = useMemo(
    () => new PerspectiveCamera(38, 1, cmToScene(1), cmToScene(30000)),
    [],
  );
  const top = useMemo(
    () =>
      Object.assign(
        new OrthographicCamera(-1, 1, 1, -1, cmToScene(1), cmToScene(30000)),
        { manual: true },
      ),
    [],
  );
  const active = mode === "top" ? top : perspective;

  useLayoutEffect(() => {
    const aspect = size.width / Math.max(size.height, 1);
    perspective.aspect = aspect;
    perspective.updateProjectionMatrix();
    const availableWidth = Math.max(size.width - 356, size.width * 0.55);
    const halfHeight = Math.max(
      d * 0.62,
      (w * 0.58 * size.height) / availableWidth,
    );
    top.left = -halfHeight * aspect;
    top.right = halfHeight * aspect;
    top.top = halfHeight;
    top.bottom = -halfHeight;
    top.setViewOffset(
      size.width,
      size.height,
      (size.width - availableWidth) / 2,
      0,
      size.width,
      size.height,
    );
    top.updateProjectionMatrix();
    invalidate();
  }, [size.width, size.height, perspective, top, w, d, invalidate]);

  useLayoutEffect(() => {
    set({ camera: active });
    const orbit = new OrbitControls(active, gl.domElement);
    controls.current = orbit;
    // No residual camera velocity can leak into or resume after an object drag.
    orbit.enableDamping = false;
    orbit.enableRotate = mode !== "top";
    orbit.screenSpacePanning = mode === "top";
    orbit.maxPolarAngle = Math.PI / 2 - 0.035;
    orbit.minPolarAngle = 0.08;
    orbit.minDistance = span * 0.3;
    orbit.maxDistance = span * 4;
    orbit.minZoom = 0.45;
    orbit.maxZoom = 5;
    const onChange = () => invalidate();
    const onDrag = (event: Event) => {
      orbit.enabled = !(event as CustomEvent<boolean>).detail;
    };
    orbit.addEventListener("change", onChange);
    gl.domElement.addEventListener("friday-drag", onDrag);
    return () => {
      orbit.removeEventListener("change", onChange);
      gl.domElement.removeEventListener("friday-drag", onDrag);
      orbit.dispose();
      controls.current = null;
    };
  }, [active, mode, gl, set, invalidate, span]);

  useLayoutEffect(() => {
    const orbit = controls.current;
    if (!orbit) return;
    active.zoom = 1;
    if (mode === "top") {
      active.up.set(0, 0, -1);
      active.position.set(w / 2, span * 2.5, d / 2);
      orbit.target.set(w / 2, 0, d / 2);
    } else {
      active.up.set(0, 1, 0);
      const width = size.width;
      const height = Math.max(size.height, 1);
      const availableWidth = Math.max(width - 356, width * 0.55);
      perspective.clearViewOffset();
      orbit.target.set(w / 2, h * 0.4, d / 2);
      const corners: Vector3[] = [];
      for (const x of [-cmToScene(12), w + cmToScene(12)]) {
        for (const y of [-cmToScene(18), h]) {
          for (const z of [-cmToScene(12), d + cmToScene(12)])
            corners.push(new Vector3(x, y, z));
        }
      }
      const boundsAt = (distance: number) => {
        perspective.position.set(
          w / 2 + distance * 0.75,
          h * 0.4 + distance * 0.82,
          d / 2 + distance,
        );
        perspective.lookAt(orbit.target);
        perspective.updateMatrixWorld();
        const points = corners.map((point) =>
          point.clone().project(perspective),
        );
        const xs = points.map((point) => ((point.x + 1) * width) / 2);
        const ys = points.map((point) => ((1 - point.y) * height) / 2);
        return {
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        };
      };
      // Fit the physical room's projected bounds into the space left of the inspector.
      let near = span * 0.5;
      let far = span * 4;
      for (let step = 0; step < 24; step++) {
        const distance = (near + far) / 2;
        const bounds = boundsAt(distance);
        if (
          bounds.right - bounds.left > availableWidth * 0.91 ||
          bounds.bottom - bounds.top > height * 0.79
        )
          near = distance;
        else far = distance;
      }
      const bounds = boundsAt(far);
      perspective.setViewOffset(
        width,
        height,
        (bounds.left + bounds.right) / 2 - availableWidth / 2,
        (bounds.top + bounds.bottom) / 2 - height * 0.51,
        width,
        height,
      );
    }
    active.updateProjectionMatrix();
    orbit.update();
    invalidate();
  }, [
    active,
    mode,
    resetKey,
    w,
    d,
    h,
    span,
    gl,
    invalidate,
    size.width,
    size.height,
    perspective,
  ]);

  useEffect(() => {
    if (controls.current) controls.current.enabled = !interactionActive;
    invalidate();
  }, [interactionActive, mode, invalidate]);
  useFrame(() => {
    if (controls.current?.enabled) controls.current.update();
  });
  return null;
}
