export type Pose = { xCm: number; zCm: number; yawRad: number };
export type FirstPersonCamera = {
  kind: "firstPerson";
  xCm: number; yCm: number; zCm: number;
  yawRad: number; pitchRad: number; fovDeg: number;
};
export type RoomSpatial = {
  freeAreas: { minXcm: number; maxXcm: number; minZcm: number; maxZcm: number }[];
  obstacles: { obstacleId: string; label: string; xCm: number; zCm: number; widthCm: number; depthCm: number; yawRad: number }[];
};
export type RoomScan = {
  /** Measured mesh footprint, in the same local centimetres as placement. */
  floorOutlineCm?: { outer: [number, number][]; holes: [number, number][][] }[];
  building?: {
    buildingId: string;
    sourceSha256: string;
    floorId: string;
    surfaceId: string;
    elevationM: number;
    levels: { roomId: string; floorId: string }[];
  };
  geometryRevision: string;
  calibration: { status: "synthetic_demo" | "confirmed" | "unconfirmed"; note: string };
  visualUrl: string;
  visualFormat?: "splat" | "glb";
  surfaceUrl?: string;
  positionCm: [number, number, number];
  rotationDeg: [number, number, number];
  scale: number;
  defaultCamera: FirstPersonCamera;
  attribution: { title: string; author: string; url: string; license: string; licenseUrl: string };
};
export type Room = {
  roomId: string;
  revision: number;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  scan?: RoomScan;
  spatial?: RoomSpatial;
};
export type Product = {
  productId: string;
  name: string;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  modelUrl?: string;
  thumbnailUrl?: string;
  catalogueVisible?: boolean;
  /** True only for a reviewed horizontal support category, not the visual "table" silhouette. */
  supportSurface?: boolean;
  color: string;
  kind: "sofa" | "table" | "chair";
};
/** `product` is optional and additive: instances of the shared fixture products omit it, while an item
 *  from the catalogue carries its own, so a scene does not depend on shared/scene-fixtures.json. */
export type Instance = { instanceId: string; productId: string; pose: Pose; product?: Product };
export type SceneEdit =
  | { type: "add"; instance: Instance }
  | { type: "setPose"; instanceId: string; pose: Pose }
  | { type: "remove"; instanceId: string };
export type CameraMode = "perspective" | "top";
