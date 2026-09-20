import * as pc from "playcanvas";
import type { Pose, Product, Room } from "../types";
import { cmToScene } from "../units";
import type { PlacementPreview } from "./contracts";

export function placementTone(result: Pick<PlacementPreview, "valid" | "reason">): "green" | "red" | "amber" {
  if (result.valid) return "green";
  return /unknown|unconfirmed|uncalibrated|unreviewed|unverified|not reviewed|cannot validate|missing|loading|point at the floor/i.test(result.reason) ? "amber" : "red";
}
const palette = { green: "#63ba8c", red: "#e07c68", amber: "#d6aa63" };
const GRID_STEP_CM = 5;

function footprintCorners(product: Pick<Product, "widthCm" | "depthCm">, pose: Pose, height = 1) {
  const c = Math.cos(pose.yawRad), s = Math.sin(pose.yawRad);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const x = sx * product.widthCm / 2, z = sz * product.depthCm / 2;
    return new pc.Vec3(cmToScene(pose.xCm + c * x + s * z), cmToScene((pose.yCm ?? 0) + height), cmToScene(pose.zCm - s * x + c * z));
  });
}

export function createPlacementOverlays(runtime: { app: pc.Application; capturing: boolean; disposed: boolean }, parent: pc.Entity) {
  const root = new pc.Entity("Placement overlays"); parent.addChild(root);
  const fill = new pc.StandardMaterial();
  fill.useLighting = false; fill.blendType = pc.BLEND_NORMAL; fill.opacity = 0.15;
  fill.depthWrite = false; fill.cull = pc.CULLFACE_NONE; fill.update();
  const footprint = new pc.Entity("Placement footprint");
  footprint.addComponent("render", { type: "plane", material: fill, castShadows: false, receiveShadows: false });
  root.addChild(footprint); footprint.enabled = false;
  const planMaterial = new pc.StandardMaterial();
  planMaterial.diffuse = new pc.Color().fromString("#b9b5ad"); planMaterial.useLighting = false; planMaterial.update();
  const plan = new pc.Entity("Schematic floor");
  plan.addComponent("render", { type: "plane", material: planMaterial, castShadows: false, receiveShadows: false });
  root.addChild(plan); plan.enabled = false;
  const reviewedMaterial = new pc.StandardMaterial();
  reviewedMaterial.diffuse = new pc.Color().fromString("#e0e3d1"); reviewedMaterial.useLighting = false; reviewedMaterial.update();
  const obstacleMaterial = new pc.StandardMaterial();
  obstacleMaterial.diffuse = new pc.Color().fromString("#c9a69d"); obstacleMaterial.useLighting = false; obstacleMaterial.update();
  const regions = new pc.Entity("Reviewed floor and fixed obstacles"); root.addChild(regions); regions.enabled = false;
  let regionKey = "";
  const regionPlane = (name: string, material: pc.StandardMaterial, x: number, z: number, width: number, depth: number, height: number, yaw = 0) => {
    const entity = new pc.Entity(name);
    entity.addComponent("render", { type: "plane", material, castShadows: false, receiveShadows: false });
    entity.setLocalPosition(cmToScene(x), cmToScene(height), cmToScene(z));
    entity.setLocalScale(cmToScene(width), 1, cmToScene(depth));
    entity.setLocalEulerAngles(0, yaw * pc.math.RAD_TO_DEG, 0);
    regions.addChild(entity);
  };
  let current: { room: Room; product: Product | null; preview: PlacementPreview | null; view: "perspective" | "top" } | null = null;
  const line = (a: pc.Vec3, b: pc.Vec3, color: pc.Color) => runtime.app.drawLine(a, b, color, true);
  const frame = () => {
    if (!current || runtime.capturing || runtime.disposed || !parent.enabled) return;
    const { room, product, preview, view } = current;
    const gridColor = new pc.Color().fromString("#ad9f89");
    const majorColor = new pc.Color().fromString("#d9c1a2");
    if (view === "top") {
      const outline = room.scan?.floorOutlineCm;
      if (outline) {
        for (const polygon of outline) for (const ring of [polygon.outer, ...polygon.holes])
          for (let i = 0; i < ring.length - 1; i++)
            line(new pc.Vec3(cmToScene(ring[i][0]), cmToScene(0.3), cmToScene(ring[i][1])),
              new pc.Vec3(cmToScene(ring[i + 1][0]), cmToScene(0.3), cmToScene(ring[i + 1][1])), gridColor);
      } else {
        for (let x = 0; x <= room.widthCm; x += 50)
          line(new pc.Vec3(cmToScene(x), cmToScene(0.3), 0), new pc.Vec3(cmToScene(x), cmToScene(0.3), cmToScene(room.depthCm)), gridColor);
        for (let z = 0; z <= room.depthCm; z += 50)
          line(new pc.Vec3(0, cmToScene(0.3), cmToScene(z)), new pc.Vec3(cmToScene(room.widthCm), cmToScene(0.3), cmToScene(z)), gridColor);
        const wall = footprintCorners({ widthCm: room.widthCm, depthCm: room.depthCm }, { xCm: room.widthCm / 2, zCm: room.depthCm / 2, yawRad: 0 });
        for (let i = 0; i < 4; i++) line(wall[i], wall[(i + 1) % 4], gridColor);
      }
      for (const obstacle of room.spatial?.obstacles ?? []) {
        const corners = footprintCorners(obstacle, obstacle);
        const color = new pc.Color().fromString("#a8836b");
        for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], color);
        line(corners[0], corners[2], color); line(corners[1], corners[3], color);
      }
    }
    if (!product || !preview) return;
    const color = new pc.Color().fromString(palette[placementTone(preview)]);
    const corners = footprintCorners(product, preview.pose, 1.2);
    for (let i = 0; i < 4; i++) line(corners[i], corners[(i + 1) % 4], color);
    // Only a local patch receives fine lines; it is a calibrated floor overlay, never painted into the splat.
    const radius = Math.min(200, Math.max(product.widthCm, product.depthCm) / 2 + 35);
    const minX = Math.max(0, Math.floor((preview.pose.xCm - radius) / GRID_STEP_CM) * GRID_STEP_CM);
    const maxX = Math.min(room.widthCm, preview.pose.xCm + radius);
    const minZ = Math.max(0, Math.floor((preview.pose.zCm - radius) / GRID_STEP_CM) * GRID_STEP_CM);
    const maxZ = Math.min(room.depthCm, preview.pose.zCm + radius);
    const step = Math.max(1, Math.ceil(Math.max(maxX - minX, maxZ - minZ) / (160 * GRID_STEP_CM))) * GRID_STEP_CM;
    for (let x = minX; x <= maxX; x += step)
      line(new pc.Vec3(cmToScene(x), cmToScene(0.6), cmToScene(minZ)), new pc.Vec3(cmToScene(x), cmToScene(0.6), cmToScene(maxZ)), Math.abs(x % 50) < 0.01 ? majorColor : gridColor);
    for (let z = minZ; z <= maxZ; z += step)
      line(new pc.Vec3(cmToScene(minX), cmToScene(0.6), cmToScene(z)), new pc.Vec3(cmToScene(maxX), cmToScene(0.6), cmToScene(z)), Math.abs(z % 50) < 0.01 ? majorColor : gridColor);
  };
  runtime.app.on("update", frame);
  return {
    update(room: Room, product: Product | null, preview: PlacementPreview | null, view: "perspective" | "top") {
      current = { room, product, preview, view };
      plan.enabled = view === "top" && !room.scan?.floorOutlineCm;
      regions.enabled = view === "top";
      const nextRegionKey = JSON.stringify(room.spatial ?? null);
      if (regionKey !== nextRegionKey) {
        regionKey = nextRegionKey;
        for (const child of [...regions.children]) (child as pc.Entity).destroy();
        for (const area of room.spatial?.freeAreas ?? [])
          regionPlane("Reviewed floor", reviewedMaterial, (area.minXcm + area.maxXcm) / 2, (area.minZcm + area.maxZcm) / 2,
            area.maxXcm - area.minXcm, area.maxZcm - area.minZcm, 0.1);
        for (const obstacle of room.spatial?.obstacles ?? [])
          regionPlane(`Fixed ${obstacle.label}`, obstacleMaterial, obstacle.xCm, obstacle.zCm, obstacle.widthCm, obstacle.depthCm, 0.2, obstacle.yawRad);
      }
      plan.setLocalPosition(cmToScene(room.widthCm / 2), 0, cmToScene(room.depthCm / 2));
      plan.setLocalScale(cmToScene(room.widthCm), 1, cmToScene(room.depthCm));
      footprint.enabled = !!(product && preview);
      if (!product || !preview) return;
      footprint.setLocalPosition(cmToScene(preview.pose.xCm), cmToScene((preview.pose.yCm ?? 0) + 0.8), cmToScene(preview.pose.zCm));
      footprint.setLocalScale(cmToScene(product.widthCm), 1, cmToScene(product.depthCm));
      footprint.setLocalEulerAngles(0, preview.pose.yawRad * pc.math.RAD_TO_DEG, 0);
      fill.diffuse = new pc.Color().fromString(palette[placementTone(preview)]); fill.update();
    },
    dispose() { runtime.app.off("update", frame); root.destroy(); fill.destroy(); planMaterial.destroy(); reviewedMaterial.destroy(); obstacleMaterial.destroy(); },
  };
}
