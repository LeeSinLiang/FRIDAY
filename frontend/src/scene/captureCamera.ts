import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { CameraMode, Room } from "./types";
import { cmToScene, SCENE_UNIT_CM, validateScale } from "./units";

export type CaptureAngle = { azimuthDeg: number; elevationDeg: number };

/** Fits the complete architectural box, independently of editor viewport/controls. */
export function buildCaptureCamera(room: Room, view: CameraMode, width: number, height: number,
  angle: CaptureAngle = { azimuthDeg: 37, elevationDeg: 35 }, scale = SCENE_UNIT_CM) {
  validateScale(scale);
  if (![room.widthCm, room.depthCm, room.heightCm, width, height].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isFinite(angle.azimuthDeg) || !Number.isFinite(angle.elevationDeg) || angle.elevationDeg <= 0 || angle.elevationDeg >= 90)
    throw Error("Invalid capture camera dimensions or angle");
  const unit = (cm: number) => cmToScene(cm, scale);
  const w = unit(room.widthCm), d = unit(room.depthCm), h = unit(room.heightCm);
  const aspect = width / height;
  if (view === "top") {
    const halfHeight = Math.max((d + unit(24)) / 2, (w + unit(24)) / (2 * aspect)) / 0.86;
    const camera = Object.assign(new OrthographicCamera(-halfHeight * aspect, halfHeight * aspect, halfHeight, -halfHeight, unit(1), unit(30000)), { manual: true });
    camera.up.set(0, 0, -1);
    camera.position.set(w / 2, Math.max(w, d, h) * 3, d / 2);
    camera.lookAt(w / 2, 0, d / 2);
    camera.updateMatrixWorld();
    return camera;
  }
  const camera = Object.assign(new PerspectiveCamera(38, aspect, unit(1), unit(30000)), { manual: true });
  const azimuth = angle.azimuthDeg * Math.PI / 180;
  const elevation = angle.elevationDeg * Math.PI / 180;
  const direction = new Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation));
  const target = new Vector3(w / 2, (h - unit(18)) / 2, d / 2);
  const corners: Vector3[] = [];
  for (const x of [-unit(12), w + unit(12)]) for (const y of [-unit(18), h]) for (const z of [-unit(12), d + unit(12)]) corners.push(new Vector3(x, y, z));
  const radius = Math.max(...corners.map(point => point.distanceTo(target)));
  const fits = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return corners.every(point => {
      const projected = point.clone().project(camera);
      return Math.abs(projected.x) <= 0.86 && Math.abs(projected.y) <= 0.86 && projected.z >= -1 && projected.z <= 1;
    });
  };
  let near = radius * 1.01, far = radius * 20;
  if (!fits(far)) throw Error("Unable to fit room into capture camera");
  for (let i = 0; i < 32; i++) {
    const distance = (near + far) / 2;
    if (fits(distance)) far = distance;
    else near = distance;
  }
  fits(far);
  return camera;
}
