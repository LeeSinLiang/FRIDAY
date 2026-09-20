// THE ONLY RENDERER-SPECIFIC FILE IN THE REGION MODULE.
//
// Draws a floor-grid-v1 mask on the floor and reports clicks on it. Interface: a Mask in, a Pose
// out. Everything upstream (solving, units, clauses) is renderer-free, so moving to another engine
// means rewriting this one file: upload mask.data as a single-channel texture, draw one quad.
//
// One textured plane, not a mesh per cell: a 600 x 500 cm room is 12,221 samples.

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DataTexture, DoubleSide, Mesh, NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType } from "three";
import { cmToScene, sceneToCm } from "../scene/units";
import type { Pose } from "../scene/types";
import { stateAtPoint } from "./grid";
import { FREE, type Mask } from "./types";

type Props = {
  /** What to light. null draws nothing. Only `free` samples are lit; `unknown` never is. */
  mask: Mask | null;
  /** When true the overlay takes floor clicks; otherwise it is decoration and clicks pass through. */
  armed: boolean;
  /** A click on a lit sample. Clicks anywhere else are ignored, quietly. */
  onPlace: (pose: Pose) => void;
  /** The legal sample under the pointer while armed, or null. For a placement ghost. */
  onHoverPose?: (pose: Pose | null) => void;
};

const NO_RAYCAST = () => null;
const LIFT_CM = 0.6; // above the floor and grid lines, below any furniture

const VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Texel centres sit on grid points. A soft edge inside each texel keeps the region readable at the
// grazing angles of a first-person camera, where flat colour alone would smear into a thin band.
const FRAGMENT = `
  uniform sampler2D uMask; uniform vec2 uShape; uniform float uTime; uniform float uArmed; varying vec2 vUv;
  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float state = texture2D(uMask, uv).r * 255.0;
    if (abs(state - 1.0) > 0.5) discard;
    vec2 cell = abs(fract(uv * uShape) - 0.5) * 2.0;
    float dot_ = 1.0 - smoothstep(0.55, 0.95, max(cell.x, cell.y));
    float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
    vec3 colour = mix(vec3(0.16, 0.62, 0.36), vec3(0.35, 0.95, 0.55), dot_);
    gl_FragColor = vec4(colour, (0.30 + 0.38 * dot_) * mix(0.8, pulse, uArmed));
  }`;

export default function FloorOverlay({ mask, armed, onPlace, onHoverPose }: Props) {
  const invalidate = useThree((state) => state.invalidate);
  const material = useRef<ShaderMaterial>(null);

  const texture = useMemo(() => {
    if (!mask) return null;
    const made = new DataTexture(mask.data, mask.shape[0], mask.shape[1], RedFormat, UnsignedByteType);
    made.minFilter = made.magFilter = NearestFilter;
    made.unpackAlignment = 1; // rows of 121 bytes are not a multiple of four
    made.needsUpdate = true;
    return made;
  }, [mask]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => invalidate(), [invalidate, texture, armed]);

  // The scene renders on demand, so the pulse only costs frames while something is armed.
  useFrame(({ clock }) => {
    if (!material.current || !armed) return;
    material.current.uniforms.uTime.value = clock.elapsedTime;
    invalidate();
  });

  const uniforms = useMemo(() => ({ uMask: { value: texture }, uShape: { value: [1, 1] }, uTime: { value: 0 }, uArmed: { value: 0 } }), []);
  if (!mask || !texture) return null;
  uniforms.uMask.value = texture;
  uniforms.uShape.value = [mask.shape[0], mask.shape[1]];
  uniforms.uArmed.value = armed ? 1 : 0;

  // One texel per grid point, so the quad overhangs the first and last point by half a cell.
  const size = mask.cellSizeCm, widthCm = mask.shape[0] * size, depthCm = mask.shape[1] * size;
  const centreX = mask.originCm[0] + widthCm / 2 - size / 2, centreZ = mask.originCm[1] + depthCm / 2 - size / 2;

  const poseAt = (event: ThreeEvent<PointerEvent | MouseEvent>): Pose | null => {
    const xCm = Math.round(sceneToCm(event.point.x) / size) * size, zCm = Math.round(sceneToCm(event.point.z) / size) * size;
    return stateAtPoint(mask, xCm, zCm) === FREE ? { xCm, zCm, yawRad: mask.yawRad } : null;
  };

  return (
    <mesh
      position={[cmToScene(centreX), cmToScene(LIFT_CM), cmToScene(centreZ)]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
      // Unarmed, the overlay must not swallow clicks meant for the floor or furniture.
      raycast={armed ? Mesh.prototype.raycast : NO_RAYCAST}
      onPointerMove={(event) => { if (armed) { event.stopPropagation(); onHoverPose?.(poseAt(event)); } }}
      onPointerOut={() => onHoverPose?.(null)}
      onClick={(event) => {
        if (!armed) return;
        event.stopPropagation();
        const pose = poseAt(event);
        if (pose) onPlace(pose); // outside the lit region: nothing happens, and that is the message
      }}
    >
      <planeGeometry args={[cmToScene(widthCm), cmToScene(depthCm)]} />
      <shaderMaterial ref={material} vertexShader={VERTEX} fragmentShader={FRAGMENT} uniforms={uniforms}
        transparent depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}
