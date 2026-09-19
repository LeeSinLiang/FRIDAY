import { useMemo } from "react";
import type { Room } from "./types";
import { cmToScene } from "./units";

// One surface rather than thousands of line objects. Derivatives suppress subpixel lines.
const vertexShader = `
varying vec2 floorPosition;
void main() {
  floorPosition = vec2(position.x, -position.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const fragmentShader = `
varying vec2 floorPosition;
uniform vec2 origin;
float grid(vec2 p, float spacing) {
  vec2 coord = p / spacing;
  vec2 width = max(fwidth(coord), vec2(0.0001));
  vec2 edge = abs(fract(coord - 0.5) - 0.5) / width;
  float line = 1.0 - min(min(edge.x, edge.y), 1.0);
  float fade = 1.0 - smoothstep(0.2, 0.55, max(width.x, width.y));
  return line * fade;
}
void main() {
  vec2 p = floorPosition + origin;
  float fine = grid(p, 1.0) * 0.085;
  float major = grid(p, 10.0) * 0.16;
  gl_FragColor = vec4(0.40, 0.31, 0.23, max(fine, major));
}`;

export default function Grid({ room }: { room: Room }) {
  const w = cmToScene(room.widthCm);
  const d = cmToScene(room.depthCm);
  const uniforms = useMemo(
    () => ({ origin: { value: [w / 2, d / 2] } }),
    [w, d],
  );
  return (
    <mesh
      position={[w / 2, cmToScene(0.08), d / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      raycast={() => {}}
      renderOrder={1}
    >
      <planeGeometry args={[w, d]} />
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
