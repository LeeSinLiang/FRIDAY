import { Canvas } from "@react-three/fiber";
import { Component, useCallback, type ReactNode } from "react";
import Room from "./scene/Room";
import PerformanceProbe, {
  type PerformanceSample,
} from "./scene/PerformanceProbe";
import Grid from "./scene/Grid";
import SceneControls from "./scene/SceneControls";
import Furniture from "./scene/Furniture";
import { useFurnitureDrag } from "./scene/useFurnitureDrag";
import { ROOM } from "./scene/fixtures";
import { cmToScene } from "./scene/units";
import type { CameraMode, Instance, Pose, Product } from "./scene/types";
export type ModelStatus = "loading" | "ready" | "error" | "proxy";
type Props = {
  instances: Instance[];
  products: Product[];
  selectedId: string | null;
  mode: CameraMode;
  resetKey: number;
  snap: boolean;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, pose: Pose) => void;
  onActiveChange: (active: boolean) => void;
  onModelStatus: (id: string, status: ModelStatus) => void;
  retries: Record<string, number>;
  interactionActive: boolean;
  onPerformanceSample?: (sample: PerformanceSample) => void;
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
}: {
  instance: Instance;
  product: Product;
  selected: boolean;
  bind: ReturnType<typeof useFurnitureDrag>["bind"];
  status: Props["onModelStatus"];
  retryKey: number;
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
      {...bind(instance)}
      onModelStatus={report}
      retryKey={retryKey}
    />
  );
}
function Contents(props: Props) {
  const drag = useFurnitureDrag({
    instances: props.instances,
    snap: props.snap,
    onSelect: props.onSelect,
    onCommit: props.onCommit,
    onActiveChange: props.onActiveChange,
  });
  return (
    <>
      <color attach="background" args={["#f0e7db"]} />
      <hemisphereLight args={["#fff7e9", "#b59d82", 2.3]} />
      <directionalLight
        position={[cmToScene(150), cmToScene(850), cmToScene(400)]}
        intensity={3.1}
        color="#fff2db"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={cmToScene(-700)}
        shadow-camera-right={cmToScene(700)}
        shadow-camera-top={cmToScene(700)}
        shadow-camera-bottom={cmToScene(-700)}
        shadow-camera-near={cmToScene(10)}
        shadow-camera-far={cmToScene(1800)}
        shadow-bias={-0.0003}
        shadow-normalBias={cmToScene(0.3)}
      />
      <Room
        room={ROOM}
        mode={props.mode}
        onFloorClick={() => props.onSelect(null)}
      />
      <Grid room={ROOM} />
      {props.instances.map((instance) => {
        const product = props.products.find(
          (p) => p.productId === instance.productId,
        );
        return product ? (
          <Item
            key={instance.instanceId}
            instance={instance}
            product={product}
            selected={props.selectedId === instance.instanceId}
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
