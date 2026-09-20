import type { Room } from "../types";
import { roomVisualKey } from "../buildingFloors";
import { cmToScene, meterGlbToSceneScale } from "../units";
import { setFirstPersonCamera, type PlayCanvasRuntime } from "./runtime";

/** Called after capture restoration and interaction disposal; keeps the loaded GLB intact. */
export function switchBuildingFloor(runtime: PlayCanvasRuntime, room: Room) {
  if (runtime.capturing || runtime.disposed || !room.scan?.building || !runtime.room.scan?.building ||
      roomVisualKey(room) !== roomVisualKey(runtime.room) || runtime.roomRoot.children.length !== 1)
    throw new Error("Cannot reuse this renderer for the requested floor");
  const model = runtime.roomRoot.children[0];
  model.setLocalPosition(...room.scan.positionCm.map(value => cmToScene(value)) as [number, number, number]);
  model.setLocalEulerAngles(...room.scan.rotationDeg);
  const scale = room.scan.scale * meterGlbToSceneScale();
  model.setLocalScale(scale, scale, scale);
  runtime.room = room;
  setFirstPersonCamera(runtime.camera, room.scan.defaultCamera);
  runtime.app.renderNextFrame = true;
}
