import { Canvas } from '@react-three/fiber'

export default function Scene() {
  return (
    <Canvas frameloop="demand" camera={{ position: [4, 3, 5], fov: 45 }}
      fallback={<p>WebGL is required to display the 3D scene.</p>}>
      <ambientLight intensity={1.5} />
      <directionalLight position={[3, 5, 2]} intensity={2} />
      <mesh rotation={[0.2, 0.5, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#4b8475" />
      </mesh>
      <gridHelper args={[10, 10]} position={[0, -0.5, 0]} />
    </Canvas>
  )
}
