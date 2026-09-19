import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

// The exporter uses FileReader for its binary Blob even without textures.
globalThis.FileReader ??= class FileReader {
  readAsArrayBuffer(blob) {
    blob
      .arrayBuffer()
      .then((buffer) => {
        this.result = buffer;
        this.onloadend?.();
      })
      .catch((error) => {
        this.error = error;
        this.onerror?.(error);
      });
  }
};

const source = new Group();
source.name = "Meter convention test fixture — 200 × 100 × 100 cm";
const material = new MeshStandardMaterial({
  color: "#c65a2e",
  roughness: 0.85,
});
const seat = new Mesh(new BoxGeometry(2, 0.5, 1), material);
seat.name = "Seat";
seat.position.y = 0.25;
const back = new Mesh(new BoxGeometry(2, 0.5, 0.25), material);
back.name = "Back (+Z is front)";
back.position.set(0, 0.75, -0.375);
source.add(seat, back);

const binary = await new GLTFExporter().parseAsync(source, { binary: true });
assert.ok(binary instanceof ArrayBuffer);
assert.equal(new DataView(binary).getUint32(0, true), 0x46546c67, "GLB magic");
const { scene } = await new GLTFLoader().parseAsync(binary, "");
const bounds = new Box3().setFromObject(scene);
const size = bounds.getSize(new Vector3());
for (const [actual, expected] of [
  [size.x, 2],
  [size.y, 1],
  [size.z, 1],
  [bounds.min.x, -1],
  [bounds.min.y, 0],
  [bounds.min.z, -0.5],
]) {
  assert.ok(
    Math.abs(actual - expected) < 1e-6,
    `Expected ${expected}, got ${actual}`,
  );
}
const first = clone(scene),
  second = clone(scene);
const firstSeat = first.getObjectByName("Seat"),
  secondSeat = second.getObjectByName("Seat");
assert.ok(firstSeat?.isMesh && secondSeat?.isMesh);
assert.notEqual(firstSeat, secondSeat, "Independent hierarchies");
assert.equal(firstSeat.geometry, secondSeat.geometry, "Shared geometry");
first.position.x = 4;
assert.equal(second.position.x, 0, "Independent transforms");
first.traverse((node) => {
  if (node.isMesh) assert.ok(node.material.isMeshStandardMaterial);
});

const output = new URL(
  "../public/models/test-fixture/model.glb",
  import.meta.url,
);
await mkdir(new URL(".", output), { recursive: true });
await writeFile(output, Buffer.from(binary));
console.log(
  JSON.stringify(
    {
      path: fileURLToPath(output),
      bytes: binary.byteLength,
      boundsMeters: { min: bounds.min.toArray(), max: bounds.max.toArray() },
      dimensionsMeters: size.toArray(),
      checks:
        "GLB roundtrip, PBR material, exact bounds, independent clones and transforms passed",
    },
    null,
    2,
  ),
);
