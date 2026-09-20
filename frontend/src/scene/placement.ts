import { productOf } from "./products";
import type { Instance, Pose, Product, Room } from "./types";

export type PlacementResult = {
  valid: boolean;
  reason: string;
  collidingIds: string[];
};
const EPSILON_CM = 1e-6;
type Axis = [number, number];
type Footprint = { x: number; z: number; axes: [Axis, Axis]; half: [number, number]; extentX: number; extentZ: number };
const positive = (values: number[]) => values.every(n => Number.isFinite(n) && n > 0);
const validPose = (pose: Pose) => !!pose && [pose.xCm, pose.zCm, pose.yawRad].every(Number.isFinite);
const validRoom = (room: Room) => positive([room.widthCm, room.depthCm, room.heightCm]);
const validProduct = (product: Product) => positive([product.widthCm, product.depthCm, product.heightCm]);
const invalid = (reason: string, collidingIds: string[] = []): PlacementResult => ({ valid: false, reason, collidingIds });

function footprint(product: Product, pose: Pose): Footprint {
  const c = Math.cos(pose.yawRad), s = Math.sin(pose.yawRad);
  const half: [number, number] = [product.widthCm / 2, product.depthCm / 2];
  return { x: pose.xCm, z: pose.zCm, axes: [[c, -s], [s, c]], half,
    extentX: Math.abs(c) * half[0] + Math.abs(s) * half[1],
    extentZ: Math.abs(s) * half[0] + Math.abs(c) * half[1] };
}
const dot = (a: Axis, b: Axis) => a[0] * b[0] + a[1] * b[1];
function overlaps(a: Footprint, b: Footprint): boolean {
  const delta: Axis = [b.x - a.x, b.z - a.z];
  for (const axis of [...a.axes, ...b.axes]) {
    const radiusA = a.half[0] * Math.abs(dot(a.axes[0], axis)) + a.half[1] * Math.abs(dot(a.axes[1], axis));
    const radiusB = b.half[0] * Math.abs(dot(b.axes[0], axis)) + b.half[1] * Math.abs(dot(b.axes[1], axis));
    if (Math.abs(dot(delta, axis)) >= radiusA + radiusB - EPSILON_CM) return false;
  }
  return true;
}

/** Floor-footprint validation only: no mesh-level collisions or clearance claims. */
export function validatePlacement(room: Room, products: Product[], instances: Instance[], instanceId: string, pose: Pose): PlacementResult {
  if (!validRoom(room)) return invalid("Invalid room dimensions");
  if (!validPose(pose)) return invalid("Enter a finite position and rotation");
  const candidates = instances.filter(i => i.instanceId === instanceId);
  if (candidates.length !== 1) return invalid("Object is missing or duplicated");
  const product = productOf(candidates[0], products);
  if (!product || !validProduct(product)) return invalid("Invalid furniture dimensions");
  if (product.heightCm > room.heightCm + EPSILON_CM) return invalid("Too tall for this room");
  const target = footprint(product, pose);
  if (target.x - target.extentX < -EPSILON_CM || target.z - target.extentZ < -EPSILON_CM ||
    target.x + target.extentX > room.widthCm + EPSILON_CM || target.z + target.extentZ > room.depthCm + EPSILON_CM) return invalid("Outside room");
  const collidingIds: string[] = [];
  const names: string[] = [];
  for (const other of instances) {
    if (other.instanceId === instanceId) continue;
    const otherProduct = productOf(other, products);
    if (!otherProduct || !validProduct(otherProduct) || !validPose(other.pose)) return invalid("Cannot validate an existing object");
    if (overlaps(target, footprint(otherProduct, other.pose))) {
      collidingIds.push(other.instanceId);
      names.push(otherProduct.name);
    }
  }
  return collidingIds.length ? invalid(`Overlaps ${[...new Set(names)].join(", ")}`, collidingIds) : { valid: true, reason: "Ready to place", collidingIds: [] };
}

/** Deterministic nearest free grid slot; search density is bounded for large rooms. */
export function findOpenPose(room: Room, products: Product[], instances: Instance[], product: Product, preferred: Pose, stepCm: number): Pose | null {
  if (!validRoom(room) || !validProduct(product) || !validPose(preferred) || !Number.isFinite(stepCm) || stepCm <= 0) return null;
  if (!products.some(p => p.productId === product.productId)) return null;
  if (product.heightCm > room.heightCm + EPSILON_CM) return null;
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
