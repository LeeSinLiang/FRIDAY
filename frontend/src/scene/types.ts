export type Pose = { xCm: number; zCm: number; yawRad: number };
export type Room = {
  roomId: string;
  revision: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
};
export type Product = {
  productId: string;
  name: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  modelUrl?: string;
  color: string;
  kind: "sofa" | "table" | "chair";
};
export type Instance = { instanceId: string; productId: string; pose: Pose };
export type SceneEdit =
  | { type: "add"; instance: Instance }
  | { type: "setPose"; instanceId: string; pose: Pose }
  | { type: "remove"; instanceId: string };
export type CameraMode = "perspective" | "top";
