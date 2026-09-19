import { useEffect, useMemo } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Group, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Instance, Product } from "./types";
import { cmToScene } from "./units";
import FurnitureModel, { type ModelStatus } from "./FurnitureModel";

type Triple = [number, number, number];

function SoftBlock({
  size,
  position,
  color,
  radius = 0.1,
  roughness = 0.88,
}: {
  size: Triple;
  position: Triple;
  color: string;
  radius?: number;
  roughness?: number;
}) {
  const [w, h, d] = size;
  const geometry = useMemo(
    () =>
      new RoundedBoxGeometry(w, h, d, 4, Math.min(radius, w / 2, h / 2, d / 2)),
    [w, h, d, radius],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} position={position} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} />
    </mesh>
  );
}

function FurnitureProxy({ product }: { product: Product }) {
  const w = cmToScene(product.widthCm),
    h = cmToScene(product.heightCm),
    d = cmToScene(product.depthCm);
  if (product.kind === "table")
    return (
      <group>
        <mesh
          position={[0, h * 0.88, 0]}
          scale={[w / 2, h * 0.12, d / 2]}
          castShadow
          receiveShadow
        >
          <sphereGeometry args={[1, 48, 20]} />
          <meshStandardMaterial color={product.color} roughness={0.78} />
        </mesh>
        {[-1, 1].map((side) => (
          <mesh
            key={side}
            position={[side * w * 0.26, h * 0.405, 0]}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[d * 0.25, d * 0.28, h * 0.81, 32]} />
            <meshStandardMaterial color={product.color} roughness={0.92} />
          </mesh>
        ))}
      </group>
    );
  if (product.kind === "chair")
    return (
      <group>
        {[-1, 1].flatMap((x) =>
          [-1, 1].map((z) => (
            <SoftBlock
              key={`${x}:${z}`}
              size={[w * 0.095, h * 0.48, d * 0.095]}
              position={[x * w * 0.38, h * 0.24, z * d * 0.37]}
              color={product.color}
              radius={cmToScene(1.5)}
            />
          )),
        )}
        <SoftBlock
          size={[w * 0.83, h * 0.17, d * 0.94]}
          position={[0, h * 0.46, d * 0.03]}
          color="#dfcfb5"
          radius={h * 0.075}
        />
        <SoftBlock
          size={[w * 0.84, h * 0.46, d * 0.17]}
          position={[0, h * 0.77, -d * 0.415]}
          color="#dfcfb5"
          radius={d * 0.08}
        />
        {[-1, 1].map((side) => (
          <SoftBlock
            key={side}
            size={[w * 0.12, h * 0.085, d * 0.86]}
            position={[side * w * 0.44, h * 0.64, 0]}
            color={product.color}
            radius={h * 0.04}
            roughness={0.68}
          />
        ))}
      </group>
    );
  return (
    <group>
      <SoftBlock
        size={[w * 0.87, h * 0.16, d * 0.77]}
        position={[0, h * 0.08, 0]}
        color="#664331"
        radius={h * 0.035}
      />
      <SoftBlock
        size={[w * 0.99, h * 0.39, d * 0.94]}
        position={[0, h * 0.335, d * 0.015]}
        color={product.color}
        radius={h * 0.18}
      />
      <SoftBlock
        size={[w * 0.94, h * 0.65, d * 0.25]}
        position={[0, h * 0.675, -d * 0.375]}
        color={product.color}
        radius={d * 0.12}
      />
      {[-1, 1].map((side) => (
        <SoftBlock
          key={side}
          size={[w * 0.115, h * 0.58, d * 0.87]}
          position={[side * w * 0.4425, h * 0.5, d * 0.065]}
          color={product.color}
          radius={w * 0.056}
        />
      ))}
      <SoftBlock
        size={[w * 0.76, h * 0.15, d * 0.64]}
        position={[0, h * 0.49, d * 0.11]}
        color={product.color}
        radius={h * 0.07}
      />
    </group>
  );
}

function Footprint({ width, depth }: { width: number; depth: number }) {
  const geometry = useMemo(
    () =>
      new BufferGeometry().setFromPoints([
        new Vector3(-width / 2, 0, -depth / 2),
        new Vector3(width / 2, 0, -depth / 2),
        new Vector3(width / 2, 0, depth / 2),
        new Vector3(-width / 2, 0, depth / 2),
      ]),
    [width, depth],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineLoop
      geometry={geometry}
      position={[0, cmToScene(0.6), 0]}
      renderOrder={3}
      raycast={() => {}}
    >
      <lineBasicMaterial
        color="#c65a2e"
        depthTest={false}
        transparent
        opacity={0.95}
      />
    </lineLoop>
  );
}

export default function Furniture({
  product,
  instance,
  selected,
  groupRef,
  onPointerDown,
  onModelStatus,
  retryKey,
}: {
  product: Product;
  instance: Instance;
  selected: boolean;
  groupRef: (node: Group | null) => void;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onModelStatus?: (status: ModelStatus) => void;
  retryKey?: number;
}) {
  return (
    <group
      ref={groupRef}
      name={instance.instanceId}
      position={[cmToScene(instance.pose.xCm), 0, cmToScene(instance.pose.zCm)]}
      rotation={[0, instance.pose.yawRad, 0]}
      onPointerDown={onPointerDown}
    >
      <FurnitureModel
        modelUrl={product.modelUrl}
        retryKey={retryKey}
        onStatus={onModelStatus}
        fallback={<FurnitureProxy product={product} />}
      />
      {selected && (
        <Footprint
          width={cmToScene(product.widthCm)}
          depth={cmToScene(product.depthCm)}
        />
      )}
    </group>
  );
}
