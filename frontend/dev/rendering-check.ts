/** Development-only comparison fixture; uses the same renderer and capture path as the editor. */
import { createPlayCanvasRuntime, setFirstPersonCamera } from "../src/scene/playcanvas/runtime";
import { createFurnitureLayer } from "../src/scene/playcanvas/furniture";
import { capturePlayCanvasScene } from "../src/scene/playcanvas/capture";
import type { Instance, Product, Room } from "../src/scene/types";
import fixture from "../../shared/scene-fixtures.json";
import { attachAt, moveWithAttachments, profileOf, resolveAttachments } from "../src/scene/supports";

const parameters = new URLSearchParams(location.search);
const roomId = parameters.get("room") ?? "empty-room";
const lighting = parameters.get("lighting") !== "legacy";
for (const link of document.querySelectorAll<HTMLAnchorElement>("nav a")) {
  const url = new URL(link.href);
  url.searchParams.set("lighting", lighting ? "room" : "legacy");
  link.href = url.href;
}
const manifest = await (await fetch(`/rooms/${roomId}/manifest.json`)).json();
const room: Room = manifest.room;
room.spatial = await (await fetch(`/rooms/${roomId}/${manifest.spatialFile}`)).json();
const sofa = fixture.products.find(p => p.productId === "modular-sofa-grey-scan") as Product;
const table = fixture.products.find(p => p.productId === "support-demo-table") as Product;
const vase: Product = {
  productId: "abo-B07B8NVHX1", name: "Stone & Beam vase", kind: "chair", color: "#ccb7a4",
  widthCm: 10.8, depthCm: 10.8, heightCm: 20.3,
  modelUrl: "/models/furniture/abo-B07B8NVHX1/model.glb",
};
const products = [sofa, table, vase];
const positions: Record<string, [number, number, number][]> = {
  "empty-room": [[210, 170, .15], [420, 295, .15], [445, 290, 0]],
  "london-skyscraper-test": [[160, 470, 0], [360, 620, .1], [390, 610, 0]],
  "cg-arch-interior": [[945, 320, 0], [950, 560, .2], [980, 560, 0]],
  "haussmann-apartment": [[280, 620, Math.PI], [310, 430, .15], [335, 425, 0]],
};
if (!positions[roomId] || !room.scan) throw Error("Choose a prepared comparison room");
let instances: Instance[] = products.map((p, i) => ({
  instanceId: ["render-sofa", "render-table", "render-vase"][i], productId: p.productId,
  pose: { xCm: positions[roomId][i][0], zCm: positions[roomId][i][1], yawRad: positions[roomId][i][2] },
}));
const support = profileOf(table)!;
instances[2].attachment = attachAt(instances[1], support.targets.find(t => t.id === "top")!, support, instances[2].pose);
instances = resolveAttachments(instances, products);
const camera = { ...room.scan.defaultCamera };
if (roomId === "empty-room") Object.assign(camera, { xCm: 310, yCm: 158, zCm: 530, pitchRad: -.19 });
if (roomId === "cg-arch-interior") Object.assign(camera, { xCm: 1090, yCm: 158, zCm: 740, yawRad: .38, pitchRad: -.18 });
if (roomId === "haussmann-apartment") Object.assign(camera, { xCm: 345, yCm: 155, zCm: 210, yawRad: Math.PI, pitchRad: -.18 });
const status = document.querySelector<HTMLPreElement>("#status")!;
const runtime = createPlayCanvasRuntime(document.querySelector<HTMLCanvasElement>("canvas")!, {
  room, furnitureLighting: lighting, onStatus: value => { status.textContent = value.message; },
});
const layer = createFurnitureLayer(runtime, runtime.contentRoot, () => {});
await runtime.ready;
setFirstPersonCamera(runtime.camera, camera);
layer.sync(instances, products, {});
await Promise.all(products.map(p => runtime.assets.loadContainer(p.modelUrl!)));
await new Promise<void>(resolve => runtime.app.once("frameend", resolve));
status.textContent = `READY ${roomId} · sofa on floor, vase supported at 75 cm`;

const button = (id: string) => document.querySelector<HTMLButtonElement>(id)!;
button("#captureButton").onclick = async () => {
  status.textContent = "Capturing";
  try {
    const result = await capturePlayCanvasScene(runtime, {
      captureId: "render-review", leaseToken: "local", revision: 1, view: "perspective",
      representation: "photographic", width: 960, height: 640, camera,
      snapshot: { room, products, instances, revision: 1 },
    });
    if ("error" in result) throw Error(result.error.message);
    document.querySelector<HTMLImageElement>("#capture")!.src = result.imageDataUrl;
    status.textContent = `CAPTURE READY · ${JSON.stringify(result.modelWarnings)}`;
  } catch (error) { status.textContent = String(error); }
};
button("#move").onclick = () => {
  const pose = instances[2].pose;
  instances = moveWithAttachments(instances, products, "render-vase", {
    ...pose, xCm: pose.xCm - 25, zCm: pose.zCm + 12, yawRad: 1.1,
  });
  layer.sync(instances, products, {});
  status.textContent = "MOVED vase −25cm X, +12cm Z, yaw1.1; support75cm";
};
button("#walk").onclick = () => {
  button("#walk").disabled = true;
  const start = performance.now(), frames: number[] = [];
  let previous = start;
  const sample = () => {
    const now = performance.now(), elapsed = (now - start) / 1000;
    if (elapsed > 3) frames.push(now - previous);
    previous = now;
    setFirstPersonCamera(runtime.camera, {
      ...camera, xCm: camera.xCm + Math.sin(elapsed * .6) * 32,
      zCm: camera.zCm + Math.sin(elapsed * .45) * 24, yawRad: camera.yawRad + Math.sin(elapsed * .4) * .22,
    });
    if (elapsed < 30) return;
    runtime.app.off("frameend", sample);
    setFirstPersonCamera(runtime.camera, camera);
    frames.sort((a, b) => a - b);
    status.textContent = JSON.stringify({
      roomId, lighting, frames: frames.length, medianMs: frames[Math.floor(frames.length * .5)],
      p95Ms: frames[Math.floor(frames.length * .95)], over50ms: frames.filter(x => x > 50).length,
    });
    button("#walk").disabled = false;
  };
  runtime.app.on("frameend", sample);
  status.textContent = "Walkthrough running: 30 seconds";
};
button("#detail").onclick = () => {
  const v = instances[2].pose;
  Object.assign(camera, { xCm: v.xCm + 55, yCm: 125, zCm: v.zCm + 100, yawRad: .50, pitchRad: -.32, fovDeg: 45 });
  setFirstPersonCamera(runtime.camera, camera);
  status.textContent = "DETAIL: supported vase and shadow";
};
window.addEventListener("pagehide", () => { layer.dispose(); runtime.dispose(); }, { once: true });
