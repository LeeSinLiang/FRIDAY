import type { CameraMode, Room as RoomData } from "./types";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group } from "three";
import { cmToScene } from "./units";
import { useRoomTextures, plasterFinish, plasterProgramKey, stoneFinish, stoneProgramKey } from "./RoomMaterials";

/** Canonical fixture: inside floor spans positive X/Z; the open sides face the camera. */
export default function Room({
  room,
  mode,
  onFloorClick,
}: {
  room: RoomData;
  mode: CameraMode;
  onFloorClick: () => void;
}) {
  const w = cmToScene(room.widthCm);
  const d = cmToScene(room.depthCm);
  const h = cmToScene(room.heightCm);
  const wall = cmToScene(12);
  const slab = cmToScene(18);
  const trim = cmToScene(5);
  const textures = useRoomTextures(room.widthCm, room.depthCm, room.heightCm);
  const backWall = useRef<Group>(null);
  const sideWall = useRef<Group>(null);
  useFrame(({ camera }) => {
    // Cut the wall on the camera's side of the room away, including screenshot
    // cameras looking from behind. Geometry and the physical floor stay fixed.
    if (backWall.current) backWall.current.visible = mode !== "top" && camera.position.z > cmToScene(4);
    if (sideWall.current) sideWall.current.visible = mode !== "top" && camera.position.x > cmToScene(4);
  });
  return (
    <group>
      <mesh
        position={[w / 2, -slab - cmToScene(0.1), d / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        raycast={() => {}}
      >
        <planeGeometry args={[w * 8, d * 8]} />
        <shadowMaterial transparent opacity={0.17} depthWrite={false} />
      </mesh>
      <mesh
        position={[w / 2, -slab / 2, d / 2]}
        receiveShadow
        castShadow
        onClick={(event) => {
          event.stopPropagation();
          onFloorClick();
        }}
      >
        <boxGeometry args={[w + wall * 2, slab, d + wall * 2]} />
        <meshStandardMaterial
          color="#cabcaa"
          roughness={0.88}
          map={textures?.stone}
          onBeforeCompile={stoneFinish}
          customProgramCacheKey={stoneProgramKey}
        />
      </mesh>
      <mesh
        position={[w / 2, cmToScene(0.025), d / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(event) => {
          event.stopPropagation();
          onFloorClick();
        }}
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          color="#e2d7c5"
          roughness={0.78}
          map={textures?.stone}
          bumpMap={textures?.stone}
          bumpScale={cmToScene(0.12)}
          onBeforeCompile={stoneFinish}
          customProgramCacheKey={stoneProgramKey}
        />
      </mesh>
      {mode !== "top" && (
        <group>
          <group ref={backWall}>
          <mesh position={[w / 2, h / 2, -wall / 2]} castShadow receiveShadow>
            <boxGeometry args={[w + wall * 2, h, wall]} />
            <meshStandardMaterial
              color="#eee2d0"
              roughness={0.96}
              map={textures?.plaster}
              bumpMap={textures?.plaster}
              bumpScale={cmToScene(0.15)}
              onBeforeCompile={plasterFinish}
              customProgramCacheKey={plasterProgramKey}
            />
          </mesh>
          <mesh position={[w / 2, trim / 2, cmToScene(0.6)]} receiveShadow>
            <boxGeometry args={[w, trim, cmToScene(1.2)]} />
            <meshStandardMaterial color="#d5c4ad" roughness={0.86} />
          </mesh>
          </group>
          <group ref={sideWall}>
          <mesh position={[-wall / 2, h / 2, d / 2]} castShadow receiveShadow>
            <boxGeometry args={[wall, h, d]} />
            <meshStandardMaterial
              color="#e7dac7"
              roughness={0.96}
              map={textures?.plaster}
              bumpMap={textures?.plaster}
              bumpScale={cmToScene(0.15)}
              onBeforeCompile={plasterFinish}
              customProgramCacheKey={plasterProgramKey}
            />
          </mesh>
          <mesh position={[cmToScene(0.6), trim / 2, d / 2]} receiveShadow>
            <boxGeometry args={[cmToScene(1.2), trim, d]} />
            <meshStandardMaterial color="#d5c4ad" roughness={0.86} />
          </mesh>
          </group>
        </group>
      )}
    </group>
  );
}
