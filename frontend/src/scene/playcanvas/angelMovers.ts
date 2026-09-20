import * as pc from 'playcanvas';
import { cmToScene } from '../units';
import type { Pose } from '../types';
import type { PlayCanvasRuntime } from './runtime';
import { createAngelBlob } from './angelBlob';
import { motionPose, type planAngelMove } from './angelMotion';

type Plan = NonNullable<ReturnType<typeof planAngelMove>>;

/** Visual-only helpers: scene state and frozen agent captures retain the accepted pose. */
export function createAngelMovers(runtime: PlayCanvasRuntime, preview: (id: string, pose: Pose) => void) {
  const root = new pc.Entity('AI angel movers');
  runtime.contentRoot.addChild(root);
  let blobs: ReturnType<typeof createAngelBlob>[] = [];
  let plan: Plan | null = null;
  let elapsed = 0;
  const stop = () => {
    if (plan) preview(plan.instanceId, plan.to);
    plan = null;
    for (const blob of blobs) blob.dispose();
    blobs = [];
  };
  return {
    start(next: Plan) {
      stop();
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      plan = next; elapsed = 0;
      blobs = [createAngelBlob(), createAngelBlob()];
      for (const blob of blobs) root.addChild(blob.entity);
    },
    update(dt: number, visible: boolean) {
      root.enabled = visible;
      if (!plan || runtime.capturing) return;
      if (!visible) { stop(); return; }
      elapsed += Math.min(dt, 0.1);
      // Development-only freeze for capturing and reviewing the live character poses.
      if (import.meta.env.DEV && new URLSearchParams(location.search).has("angelScreenshot")) elapsed = Math.min(elapsed, 1.8);
      const approach = 0.9, celebrate = 1.2, depart = 0.9;
      const progress = plan.duration ? Math.min(1, Math.max(0, (elapsed - approach) / plan.duration)) : 1;
      const pose = motionPose(plan.from, plan.to, progress * progress * (3 - 2 * progress));
      preview(plan.instanceId, pose);
      const arrival = approach + plan.duration;
      if (elapsed > arrival + celebrate + depart) { stop(); return; }
      const dx = plan.to.xCm - plan.from.xCm, dz = plan.to.zCm - plan.from.zCm;
      const direction = Math.hypot(dx, dz) > 1 ? Math.atan2(dx, dz) : pose.yawRad;
      const local = direction - pose.yawRad;
      const sideX = Math.abs(Math.sin(local)) > Math.abs(Math.cos(local));
      const sign = sideX ? -Math.sign(Math.sin(local)) : -Math.sign(Math.cos(local));
      const walkIn = Math.max(0, 1 - elapsed / approach) * 30;
      const walkOut = Math.max(0, (elapsed - arrival - celebrate) / depart) * 30;
      for (let i = 0; i < blobs.length; i++) {
        const lateral = (i ? 1 : -1) * Math.min(32, (sideX ? plan.product.depthCm : plan.product.widthCm) * 0.22);
        const back = (sideX ? plan.product.widthCm : plan.product.depthCm) / 2 + 17 + walkIn + walkOut;
        const x = sideX ? sign * back : lateral, z = sideX ? lateral : sign * back;
        const c = Math.cos(pose.yawRad), s = Math.sin(pose.yawRad);
        const blob = blobs[i];
        blob.entity.setLocalPosition(cmToScene(pose.xCm + x * c + z * s), 0, cmToScene(pose.zCm - x * s + z * c));
        const face = pose.yawRad + (sideX ? -sign * Math.PI / 2 : sign > 0 ? Math.PI : 0);
        blob.entity.setLocalEulerAngles(0, face * pc.math.RAD_TO_DEG + (walkOut > 0 ? 180 : 0), 0);
        const celebrating = elapsed >= arrival && elapsed <= arrival + celebrate;
        blob.animate(elapsed + i * 0.12, !celebrating, elapsed >= approach && elapsed < arrival,
          celebrating ? (elapsed - arrival) / celebrate : 0);
        // Shrink into a soft pop only after walking away, keeping feet on the floor.
        const scale = Math.min(1, elapsed / 0.18, Math.max(0, 1 - walkOut / 30));
        blob.entity.setLocalScale(scale, scale, scale);
      }
    },
    stop,
    dispose() { stop(); root.destroy(); },
  };
}
