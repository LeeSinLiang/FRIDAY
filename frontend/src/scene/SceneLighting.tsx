import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { Object3D, PMREMGenerator } from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { CameraMode } from "./types";
import { cmToScene } from "./units";

/** Shared by the interactive editor and the independent screenshot renderer. */
export default function SceneLighting({ mode = "perspective" }: { mode?: CameraMode }) {
  const { gl, scene, invalidate } = useThree();
  const target = useMemo(() => {
    const object = new Object3D();
    object.position.set(cmToScene(230), 0, cmToScene(180));
    return object;
  }, []);
  useEffect(() => {
    const studio = new RoomEnvironment();
    const generator = new PMREMGenerator(gl);
    const environment = generator.fromScene(studio, .03);
    const previous = scene.environment, intensity = scene.environmentIntensity;
    scene.environment=environment.texture;
    scene.environmentIntensity=.34;
    invalidate();
    studio.dispose(); generator.dispose();
    return () => {
      if (scene.environment === environment.texture) { scene.environment=previous; scene.environmentIntensity=intensity; }
      environment.dispose();
    };
  }, [gl, scene, target, invalidate]);
  return <>
    <mesh frustumCulled={false} renderOrder={-1000} raycast={() => {}}>
      <planeGeometry args={[2,2]} />
      <shaderMaterial depthTest={false} depthWrite={false} toneMapped={false}
        vertexShader={`varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`}
        fragmentShader={`varying vec2 vUv; void main(){
          vec3 cream=vec3(.965,.944,.910), sand=vec3(.850,.803,.737);
          float vignette=smoothstep(.15,.9,length((vUv-vec2(.43,.58))*vec2(1.,.8)));
          vec3 color=mix(cream,sand,clamp(vignette*.52+(1.-vUv.y)*.11,0.,1.));
          gl_FragColor=vec4(color,1.0);
        }`} />
    </mesh>
    <hemisphereLight args={["#fff6e5", "#ad9277", mode === "top" ? 1.15 : .9]} />
    <directionalLight position={[cmToScene(-350),cmToScene(650),cmToScene(200)]} color="#e4edff" intensity={.65} />
    <primitive object={target} />
    <spotLight position={[cmToScene(740),cmToScene(1000),cmToScene(650)]}
      color="#fff0d9" intensity={3.4} decay={0} angle={.68} penumbra={.65}
      target={target} castShadow shadow-mapSize={[2048,2048]}
      shadow-bias={-.00015} shadow-normalBias={cmToScene(.22)}
      shadow-camera-near={cmToScene(30)} shadow-camera-far={cmToScene(1800)} />
  </>;
}
