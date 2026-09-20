import { productOf } from "./products";
import { moveWithAttachments, supportFit, solidParts } from "./supports";
import type { Attachment, Instance, Pose, Product, Room } from "./types";

export type PlacementResult = {
  valid: boolean;
  reason: string;
  collidingIds: string[];
  code?: "fixed_obstacle" | "unknown_area" | "scale_unconfirmed";
  assurance?: "fixture" | "confirmed" | "synthetic_demo";
};
const EPSILON_CM = 1e-6;
type Axis = [number, number];
type Footprint = { x: number; z: number; axes: [Axis, Axis]; half: [number, number]; extentX: number; extentZ: number };
const positive = (values: number[]) => values.every(n => Number.isFinite(n) && n > 0);
const validPose = (pose: Pose) => !!pose && [pose.xCm, pose.zCm, pose.yawRad, pose.yCm ?? 0].every(Number.isFinite);
const validRoom = (room: Room) => positive([room.widthCm, room.depthCm, room.heightCm]);
const validProduct = (product: Product) => positive([product.widthCm, product.depthCm, product.heightCm]);
const invalid = (reason: string, collidingIds: string[] = [], code?: PlacementResult["code"]): PlacementResult => ({ valid: false, reason, collidingIds, ...(code ? { code } : {}) });

function footprint(product: Pick<Product, "widthCm" | "depthCm">, pose: Pose): Footprint {
  const c = Math.cos(pose.yawRad), s = Math.sin(pose.yawRad);
  const half: [number, number] = [product.widthCm / 2, product.depthCm / 2];
  return { x: pose.xCm, z: pose.zCm, axes: [[c, -s], [s, c]], half,
    extentX: Math.abs(c) * half[0] + Math.abs(s) * half[1],
    extentZ: Math.abs(s) * half[0] + Math.abs(c) * half[1] };
}
const dot = (a: Axis, b: Axis) => a[0] * b[0] + a[1] * b[1];
/** A rug does not stop a chair. An item this low is floor covering, not an obstacle: it neither blocks other
 *  items nor is blocked by them, so furniture can stand on a rug and a rug can go under furniture that is already
 *  there. It must still lie inside the room and its verified floor, and clear of fixed obstacles.
 *  KEEP IN STEP with FLAT_MAX_CM in backend/api/scene_service.py, or the editor accepts what the server refuses. */
export const FLAT_MAX_CM = 3;
const isFlat = (product: Product): boolean => product.heightCm <= FLAT_MAX_CM + EPSILON_CM;

function overlaps(a: Footprint, b: Footprint): boolean {
  const delta: Axis = [b.x - a.x, b.z - a.z];
  for (const axis of [...a.axes, ...b.axes]) {
    const radiusA = a.half[0] * Math.abs(dot(a.axes[0], axis)) + a.half[1] * Math.abs(dot(a.axes[1], axis));
    const radiusB = b.half[0] * Math.abs(dot(b.axes[0], axis)) + b.half[1] * Math.abs(dot(b.axes[1], axis));
    if (Math.abs(dot(delta, axis)) >= radiusA + radiusB - EPSILON_CM) return false;
  }
  return true;
}

function polygon(box: Footprint): Axis[] {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [
    box.x + sx * box.half[0] * box.axes[0][0] + sz * box.half[1] * box.axes[1][0],
    box.z + sx * box.half[0] * box.axes[0][1] + sz * box.half[1] * box.axes[1][1],
  ]);
}

function clipPolygon(points: Axis[], axis: 0 | 1, boundary: number, keepGreater: boolean): Axis[] {
  const result: Axis[] = [];
  if (!points.length) return result;
  const inside = (point: Axis) => keepGreater ? point[axis] >= boundary : point[axis] <= boundary;
  let previous = points[points.length - 1];
  for (const current of points) {
    if (inside(current) !== inside(previous)) {
      const ratio = (boundary - previous[axis]) / (current[axis] - previous[axis]);
      result.push([previous[0] + ratio * (current[0] - previous[0]), previous[1] + ratio * (current[1] - previous[1])]);
    }
    if (inside(current)) result.push(current);
    previous = current;
  }
  return result;
}

const polygonArea = (points: Axis[]) => Math.abs(points.reduce((sum, point, index) => {
  const next = points[(index + 1) % points.length];
  return sum + point[0] * next[1] - next[0] * point[1];
}, 0)) / 2;

type FreeArea = NonNullable<Room["spatial"]>["freeAreas"][number];
type FloorRow = { minX: number; maxX: number }[];
const floorRows = new WeakMap<FreeArea[], { zs: number[]; rows: FloorRow[] }>();

/** Exact horizontal coverage for quarter-turn footprints. Large prepared floors contain hundreds
 * of reviewed rectangles; indexing their Z bands avoids clipping against every rectangle at each
 * 5 cm fit sample. Touching intervals form one continuous verified strip. */
function coveredByAxisAlignedAreas(box: Footprint, areas: FreeArea[]): boolean {
  if (!areas.length) return false;
  let index = floorRows.get(areas);
  if (!index) {
    const zs = [...new Set(areas.flatMap(area => [area.minZcm, area.maxZcm]))].sort((a, b) => a - b);
    const rows: FloorRow[] = [];
    for (let j = 0; j < zs.length - 1; j++) {
      const spans = areas.filter(area => area.minZcm <= zs[j] + EPSILON_CM && area.maxZcm >= zs[j + 1] - EPSILON_CM)
        .map(area => ({ minX: area.minXcm, maxX: area.maxXcm })).sort((a, b) => a.minX - b.minX);
      const merged: FloorRow = [];
      for (const span of spans) {
        const previous = merged[merged.length - 1];
        if (previous && span.minX <= previous.maxX + EPSILON_CM) previous.maxX = Math.max(previous.maxX, span.maxX);
        else merged.push({ ...span });
      }
      rows.push(merged);
    }
    index = { zs, rows };
    floorRows.set(areas, index);
  }
  const minX = box.x - box.extentX, maxX = box.x + box.extentX;
  const minZ = box.z - box.extentZ, maxZ = box.z + box.extentZ;
  if (minZ < index.zs[0] - EPSILON_CM || maxZ > index.zs[index.zs.length - 1] + EPSILON_CM) return false;
  let low = 0, high = index.rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (index.zs[middle + 1] <= minZ + EPSILON_CM) low = middle + 1;
    else high = middle;
  }
  for (let j = low; j < index.rows.length; j++) {
    if (index.zs[j] >= maxZ - EPSILON_CM) break;
    if (!index.rows[j].some(span => span.minX <= minX + EPSILON_CM && span.maxX >= maxX - EPSILON_CM)) return false;
  }
  return true;
}

/** Subtract the reviewed rectangle union, including gaps hidden inside the footprint. */
function coveredByFreeAreas(box: Footprint, areas: NonNullable<Room["spatial"]>["freeAreas"]): boolean {
  if (Math.abs(box.axes[0][0]) <= EPSILON_CM || Math.abs(box.axes[0][1]) <= EPSILON_CM)
    return coveredByAxisAlignedAreas(box, areas);
  let remaining = [polygon(box)];
  for (const area of areas) {
    const next: Axis[][] = [];
    const boundaries: [0 | 1, number, boolean][] = [[0, area.minXcm, true], [0, area.maxXcm, false], [1, area.minZcm, true], [1, area.maxZcm, false]];
    for (const fragment of remaining) {
      let inside = fragment;
      for (const [axis, boundary, greater] of boundaries) {
        const outside = clipPolygon(inside, axis, boundary, !greater);
        if (polygonArea(outside) > EPSILON_CM) next.push(outside);
        inside = clipPolygon(inside, axis, boundary, greater);
        if (polygonArea(inside) <= EPSILON_CM) break;
      }
    }
    remaining = next;
    if (!remaining.length) return true;
  }
  return !remaining.length;
}

function validSpatial(room: Room): boolean {
  const spatial = room.spatial;
  if (!spatial || spatial.freeAreas.length > 256 || spatial.obstacles.length > 512) return false;
  return spatial.freeAreas.every(area => [area.minXcm, area.maxXcm, area.minZcm, area.maxZcm].every(Number.isFinite) &&
    area.minXcm >= 0 && area.maxXcm <= room.widthCm && area.minXcm < area.maxXcm &&
    area.minZcm >= 0 && area.maxZcm <= room.depthCm && area.minZcm < area.maxZcm) &&
    spatial.obstacles.every(obstacle => validPose(obstacle) && positive([obstacle.widthCm, obstacle.depthCm]));
}

/** Floor-footprint validation only: no mesh-level collisions or clearance claims. */
export function validatePlacement(room: Room, products: Product[], instances: Instance[], instanceId: string, pose: Pose, attachment?: Attachment | null): PlacementResult {
  try {
    const next = moveWithAttachments(instances, products, instanceId, pose, attachment);
    const affected = next.filter(i => i.instanceId === instanceId || i.attachment?.parentInstanceId === instanceId);
    if (!affected.length) return invalid("Object is missing or duplicated");
    for (const item of affected) {
      const result = validateResolved(room, products, next, item.instanceId, item.pose);
      if (!result.valid) return result;
    }
    return validateResolved(room, products, next, instanceId, next.find(i => i.instanceId === instanceId)!.pose);
  } catch (error) { return invalid(error instanceof Error ? error.message : "Invalid support"); }
}
function validateResolved(room: Room, products: Product[], instances: Instance[], instanceId: string, pose: Pose): PlacementResult {
  if (!validRoom(room)) return invalid("Invalid room dimensions");
  if (!validPose(pose)) return invalid("Enter a finite position and rotation");
  const candidates = instances.filter(i => i.instanceId === instanceId);
  if (candidates.length !== 1) return invalid("Object is missing or duplicated");
  const product = productOf(candidates[0], products);
  if (!product || !validProduct(product)) return invalid("Invalid furniture dimensions");
  supportFit(candidates[0], product, instances, products);
  if ((pose.yCm ?? 0) + product.heightCm > room.heightCm + EPSILON_CM) return invalid("Too tall for this room");
  const target = footprint(product, pose);
  if (target.x - target.extentX < -EPSILON_CM || target.z - target.extentZ < -EPSILON_CM ||
    target.x + target.extentX > room.widthCm + EPSILON_CM || target.z + target.extentZ > room.depthCm + EPSILON_CM) return invalid("Outside room");
  if (room.scan) {
    if (!["confirmed", "synthetic_demo"].includes(room.scan.calibration.status)) return invalid("Room scale is unconfirmed", [], "scale_unconfirmed");
    if (!validSpatial(room)) return invalid("Room geometry is unavailable", [], "unknown_area");
    for (const obstacle of room.spatial?.obstacles ?? []) {
      const box = footprint({ ...product, widthCm: obstacle.widthCm, depthCm: obstacle.depthCm }, obstacle);
      if (overlaps(target, box)) return invalid(`Overlaps fixed ${obstacle.label}`, [obstacle.obstacleId], "fixed_obstacle");
    }
    if (!coveredByFreeAreas(target, room.spatial?.freeAreas ?? [])) return invalid("Unverified area", [], "unknown_area");
  }
  const collidingIds: string[] = [];
  const names: string[] = [];
  for (const other of instances) {
    if (other.instanceId === instanceId) continue;
    const otherProduct = productOf(other, products);
    if (!otherProduct || !validProduct(otherProduct) || !validPose(other.pose)) return invalid("Cannot validate an existing object");
    if ((isFlat(product) && !candidates[0].attachment) || (isFlat(otherProduct) && !other.attachment)) continue;
    const collides = candidates[0].attachment || other.attachment
      ? solidParts(candidates[0], product).some(a => solidParts(other, otherProduct).some(b =>
          a.yCm + a.heightCm > b.yCm + EPSILON_CM && b.yCm + b.heightCm > a.yCm + EPSILON_CM && overlaps(footprint(a, a), footprint(b, b))))
      : overlaps(target, footprint(otherProduct, other.pose));
    if (collides) {
      collidingIds.push(other.instanceId);
      names.push(otherProduct.name);
    }
  }
  const assurance = room.scan?.calibration.status === "synthetic_demo" ? "synthetic_demo" : room.scan ? "confirmed" : "fixture";
  return collidingIds.length ? invalid(`Overlaps ${[...new Set(names)].join(", ")}`, collidingIds) : { valid: true, reason: assurance === "synthetic_demo" ? "Fits in synthetic demo" : "Ready to place", collidingIds: [], assurance };
}

/** Deterministic nearest free grid slot; search density is bounded for large rooms. */
export function findOpenPose(room: Room, products: Product[], instances: Instance[], product: Product, preferred: Pose, stepCm: number): Pose | null {
  if (!validRoom(room) || !validProduct(product) || !validPose(preferred) || !Number.isFinite(stepCm) || stepCm <= 0) return null;
  if (!products.some(p => p.productId === product.productId)) return null;
  if (product.heightCm > room.heightCm + EPSILON_CM) return null;
  if (room.scan && (room.scan.calibration.status === "unconfirmed" || !validSpatial(room) || !room.spatial?.freeAreas.length)) return null;
  const box = footprint(product, preferred);
  if (box.extentX * 2 > room.widthCm + EPSILON_CM || box.extentZ * 2 > room.depthCm + EPSILON_CM) return null;
  let candidateId = "__placement_candidate__";
  while (instances.some(i => i.instanceId === candidateId)) candidateId += "_";
  const scene = [...instances, { instanceId: candidateId, productId: product.productId, pose: preferred }];
  const accepts = (pose: Pose) => validatePlacement(room, products, scene, candidateId, pose).valid;
  const snapped = { xCm: Math.round(preferred.xCm / stepCm) * stepCm, zCm: Math.round(preferred.zCm / stepCm) * stepCm, yawRad: preferred.yawRad };
  if (accepts(snapped)) return snapped;
  // Preserve configured grid alignment while avoiding a tiny-step billion-slot search.
  const stride = Math.ceil(Math.max(5, room.widthCm / 199, room.depthCm / 199) / stepCm) * stepCm;
  if (!Number.isFinite(stride)) return null;
  const minX = Math.ceil((box.extentX - EPSILON_CM) / stride);
  const maxX = Math.floor((room.widthCm - box.extentX + EPSILON_CM) / stride);
  const minZ = Math.ceil((box.extentZ - EPSILON_CM) / stride);
  const maxZ = Math.floor((room.depthCm - box.extentZ + EPSILON_CM) / stride);
  const slots: { pose: Pose; distance: number }[] = [];
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const pose = { xCm: x * stride, zCm: z * stride, yawRad: preferred.yawRad };
    slots.push({ pose, distance: Math.hypot(pose.xCm - preferred.xCm, pose.zCm - preferred.zCm) });
  }
  slots.sort((a, b) => a.distance - b.distance || a.pose.xCm - b.pose.xCm || a.pose.zCm - b.pose.zCm);
  return slots.find(slot => accepts(slot.pose))?.pose ?? null;
}
