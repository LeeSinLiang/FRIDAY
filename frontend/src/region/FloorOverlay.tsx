// THE ONLY RENDERER-SPECIFIC FILE IN THE REGION MODULE.
//
// Draws a floor-grid-v1 mask on the floor and reports clicks on it. Interface: a Mask in, a Pose
// out. Everything upstream (solving, units, clauses) is renderer-free, so moving to another engine
// means rewriting this one file: upload mask.data as a single-channel texture, draw one quad.
//
// One textured plane, not a mesh per cell: a 600 x 500 cm room is 12,221 samples.

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { ClampToEdgeWrapping, DataTexture, DoubleSide, Mesh, NearestFilter, RedFormat, ShaderMaterial, UnsignedByteType } from "three";
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
// Precision is declared, not inherited: drivers differ on the default, and software WebGL (where this
// was first verified) is more forgiving than phones and integrated GPUs. mediump is enough because
// nothing here grows: the pulse arrives as a 0..1 number computed in JavaScript rather than as a
// clock the shader would have to take the sine of after an hour on stage.
const FRAGMENT = `
  precision mediump float;
  precision mediump sampler2D;
  uniform sampler2D uMask; uniform vec2 uShape; uniform float uPulse; uniform float uArmed; varying vec2 vUv;
  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    float state = texture2D(uMask, uv).r * 255.0;
    if (abs(state - 1.0) > 0.5) discard;
    vec2 grid = uv * uShape;
    vec2 cell = abs(fract(grid) - 0.5) * 2.0;
    // Far away or at eye level a sample shrinks below a few pixels and the dots alias into crawling
    // lines. fwidth is how many samples one pixel spans: fade the pattern to a flat fill as it grows.
    vec2 span = fwidth(grid);
    float detail = 1.0 - smoothstep(0.18, 0.45, max(span.x, span.y));
    float dot_ = mix(0.45, 1.0 - smoothstep(0.55, 0.95, max(cell.x, cell.y)), detail);
    vec3 colour = mix(vec3(0.16, 0.62, 0.36), vec3(0.35, 0.95, 0.55), dot_);
    gl_FragColor = vec4(colour, (0.30 + 0.38 * dot_) * mix(0.8, uPulse, uArmed));
  }`;

export default function FloorOverlay({ mask, armed, onPlace, onHoverPose }: Props) {
  const invalidate = useThree((state) => state.invalidate);
  const material = useRef<ShaderMaterial>(null);

  const texture = useMemo(() => {
    if (!mask) return null;
    const made = new DataTexture(mask.data, mask.shape[0], mask.shape[1], RedFormat, UnsignedByteType);
    // Every sampling parameter is set here. Nothing is left to a default: a sample must map to
    // exactly one texel, with no blending, no mip chain and no wrap at the room's edge.
    made.minFilter = NearestFilter;
    made.magFilter = NearestFilter;
    made.generateMipmaps = false;
    made.wrapS = ClampToEdgeWrapping;
    made.wrapT = ClampToEdgeWrapping;
    made.flipY = false;
    made.unpackAlignment = 1; // rows of 121 bytes are not a multiple of four
    made.needsUpdate = true;
    return made;
  }, [mask]);
  useEffect(() => () => texture?.dispose(), [texture]);
  useEffect(() => invalidate(), [invalidate, texture, armed]);

  // The scene renders on demand, so the pulse only costs frames while something is armed.
  useFrame(({ clock }) => {
    if (!material.current || !armed) return;
    material.current.uniforms.uPulse.value = 0.85 + 0.15 * Math.sin(clock.elapsedTime * 3);
    invalidate();
  });

  // Initial values only. three.js CLONES a ShaderMaterial's uniforms, so later writes to this object
  // never reach the GPU: every update below goes through material.current.uniforms instead. Writing
  // to this object is how the first version changed its count on R while drawing the same region.
  const initialUniforms = useMemo(() => ({ uMask: { value: null }, uShape: { value: [1, 1] }, uPulse: { value: 1 }, uArmed: { value: 0 } }), []);
  useLayoutEffect(() => {
    const live = material.current?.uniforms;
    if (!live || !mask || !texture) return;
    live.uMask.value = texture;
    live.uShape.value = [mask.shape[0], mask.shape[1]];
    live.uArmed.value = armed ? 1 : 0;
    invalidate();
  }, [mask, texture, armed, invalidate]);
  if (!mask || !texture) return null;

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
      <shaderMaterial ref={material} vertexShader={VERTEX} fragmentShader={FRAGMENT} uniforms={initialUniforms}
        transparent depthWrite={false} side={DoubleSide} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}
