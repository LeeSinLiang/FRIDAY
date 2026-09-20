import type { CameraMode, Instance, Pose, Product, Room } from "../types";

export type InteractionMode = "explore" | "walk" | "place";
export type ModelStatus = "loading" | "ready" | "error" | "proxy";
export type PlacementPreview = {
  instanceId?: string;
  pose: Pose;
  valid: boolean;
  reason: string;
  collidingIds: string[];
  assurance?: string;
};
export type InteractionState = {
  room: Room;
  products: Product[];
  instances: Instance[];
  selectedId: string | null;
  pendingProductId: string | null;
  editingEnabled: boolean;
  snap: boolean;
  mode: InteractionMode;
  view: CameraMode;
  retries: Record<string, number>;
  showSurface?: boolean;
};
export type InteractionCallbacks = {
  onSelect: (id: string | null) => void;
  onCommit: (instanceId: string, pose: Pose) => Promise<boolean>;
  onPlace: (productId: string, pose: Pose) => Promise<boolean>;
  onCancelPlacement: () => void;
  onPreview: (preview: PlacementPreview | null) => void;
  onActiveChange: (active: boolean) => void;
  onModelStatus: (instanceId: string, status: ModelStatus) => void;
  onSurfaceStatus?: (status: "loading" | "ready" | "error", message?: string) => void;
};
