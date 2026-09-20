import { Canvas } from "@react-three/fiber";
import { Component, useCallback, type ReactNode } from "react";
import Room from "./scene/Room";
import SceneLighting from "./scene/SceneLighting";
import PerformanceProbe, {
  type PerformanceSample,
} from "./scene/PerformanceProbe";
import Grid from "./scene/Grid";
import SceneControls from "./scene/SceneControls";
import Furniture from "./scene/Furniture";
import { supportHeightCm, validatePlacement } from "./scene/placement";
import { useFurnitureDrag, type PlacementPreview } from "./scene/useFurnitureDrag";
import { ROOM } from "./scene/fixtures";
import { cmToScene } from "./scene/units";
import type { CameraMode, Instance, Pose, Product } from "./scene/types";
export type ModelStatus = "loading" | "ready" | "error" | "proxy";
type Props = {
  editingEnabled: boolean;
  instances: Instance[];
  products: Product[];
  selectedId: string | null;
  mode: CameraMode;
  resetKey: number;
  snap: boolean;
  onPlacementPreview?: (preview: PlacementPreview | null) => void;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, pose: Pose) => void;
  onActiveChange: (active: boolean) => void;
  onModelStatus: (id: string, status: ModelStatus) => void;
  retries: Record<string, number>;
  interactionActive: boolean;
  onPerformanceSample?: (sample: PerformanceSample) => void;
  /** Extra scene content drawn above the floor, e.g. the placement region. */
  overlay?: ReactNode;
};
class SceneBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="canvas-error">
        <h2>The room could not render</h2>
        <p>Check that WebGL is enabled, then reload to try again.</p>
        <button className="button" onClick={() => location.reload()}>
          Reload room
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Item({
  instance,
  product,
  selected,
  bind,
  status,
  retryKey,
  placementValid,
  placementReason,
  baseHeightCm,
}: {
  instance: Instance;
  product: Product;
  selected: boolean;
  bind: ReturnType<typeof useFurnitureDrag>["bind"];
  status: Props["onModelStatus"];
  retryKey: number;
  placementValid: boolean;
  placementReason: string;
  baseHeightCm: number;
}) {
  const report = useCallback(
    (value: ModelStatus) => status(instance.instanceId, value),
    [instance.instanceId, status],
  );
  return (
    <Furniture
      product={product}
      instance={instance}
      selected={selected}
      placementValid={placementValid}
      placementReason={placementReason}
      baseHeightCm={baseHeightCm}
      {...bind(instance)}
      onModelStatus={report}
      retryKey={retryKey}
    />
  );
}
function Contents(props: Props) {
  const drag = useFurnitureDrag({
    enabled: props.editingEnabled,
    room: ROOM,
    products: props.products,
    onPreview: props.onPlacementPreview,
    instances: props.instances,
    snap: props.snap,
    onSelect: props.onSelect,
    onCommit: props.onCommit,
    onActiveChange: props.onActiveChange,
  });
  return (
    <>
      <SceneLighting mode={props.mode} />
      <Room
        room={ROOM}
        mode={props.mode}
        onFloorClick={() => props.onSelect(null)}
      />
      <Grid room={ROOM} />
      {props.overlay}
      {props.instances.map((instance) => {
        const product = props.products.find(
          (p) => p.productId === instance.productId,
        );
        const placement = validatePlacement(ROOM, props.products, props.instances, instance.instanceId, instance.pose);
        return product ? (
          <Item
            key={instance.instanceId}
            instance={instance}
            product={product}
            selected={props.selectedId === instance.instanceId}
            placementValid={placement.valid}
            placementReason={placement.reason}
            baseHeightCm={supportHeightCm(ROOM, props.products, props.instances, instance.instanceId, instance.pose)}
            bind={drag.bind}
            status={props.onModelStatus}
            retryKey={props.retries[instance.instanceId] ?? 0}
          />
        ) : null;
      })}
      {props.onPerformanceSample && (
        <PerformanceProbe
          active={props.interactionActive}
          onSample={props.onPerformanceSample}
        />
      )}
      <SceneControls
        room={ROOM}
        mode={props.mode}
        interactionActive={props.interactionActive}
        resetKey={props.resetKey}
      />
    </>
  );
}
export default function Scene(props: Props) {
  return (
    <SceneBoundary>
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 1.7]}
        camera={{
          position: [cmToScene(950), cmToScene(780), cmToScene(1100)],
          near: cmToScene(1),
          far: cmToScene(6000),
          fov: 42,
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        fallback={
          <div className="canvas-error">
            WebGL is required to display your room.
          </div>
        }
      >
        <Contents {...props} />
      </Canvas>
    </SceneBoundary>
  );
}
