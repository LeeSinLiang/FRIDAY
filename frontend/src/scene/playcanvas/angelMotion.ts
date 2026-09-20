import type { Instance, Pose, Product, Room } from '../types';
import { validatePlacement } from '../placement';

export type AgentMotion = { revision: number; instanceId: string; fromPose: Pose | null; toPose: Pose };
export const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function motionPose(from: Pose, to: Pose, t: number): Pose {
  return { xCm: from.xCm + (to.xCm - from.xCm) * t, zCm: from.zCm + (to.zCm - from.zCm) * t,
    yawRad: from.yawRad + angleDelta(from.yawRad, to.yawRad) * t,
    ...(from.yCm === undefined && to.yCm === undefined ? {} : {yCm:(from.yCm ?? 0) + ((to.yCm ?? 0)-(from.yCm ?? 0))*t}) };
}

/** A decorative move may only traverse reviewed, collision-free furniture poses. */
export function planAngelMove(event: AgentMotion, room: Room, products: Product[], instances: Instance[], camera?: {xCm:number; zCm:number}) {
  const item = instances.find(i => i.instanceId === event.instanceId);
  const product = products.find(p => p.productId === item?.productId);
  if (!item || !product || item.attachment || instances.some(i=>i.attachment?.parentInstanceId===item.instanceId)) return null;
  const to = item.pose;
  const safe = (from: Pose) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.xCm - from.xCm, to.zCm - from.zCm) / 5),
      Math.ceil(Math.abs(angleDelta(from.yawRad, to.yawRad)) / (Math.PI / 90)));
    for (let n = 0; n <= steps; n++) if (!validatePlacement(room, products, instances, item.instanceId, motionPose(from, to, n / steps)).valid) return false;
    return true;
  };
  // A newly added object gets a short final nudge, never an invented route across the room.
  const candidates = event.fromPose ? [event.fromPose] : [0, Math.PI / 2, Math.PI, -Math.PI / 2].map(yaw => ({
    ...to, xCm: to.xCm + Math.sin(yaw + to.yawRad) * 35, zCm: to.zCm + Math.cos(yaw + to.yawRad) * 35,
  }));
  if (!event.fromPose && camera) candidates.sort((a,b) =>
    Math.hypot(a.xCm-camera.xCm,a.zCm-camera.zCm)-Math.hypot(b.xCm-camera.xCm,b.zCm-camera.zCm));
  const from = candidates.find(safe) ?? to;
  return { from, to, product, instanceId: item.instanceId,
    duration: from === to ? 0 : Math.min(4, Math.max(2.4, Math.hypot(to.xCm - from.xCm, to.zCm - from.zCm) / 65)) };
}
