import * as pc from "playcanvas";

/** Three temporary silk curves around the loaded model; never part of collision geometry. */
export function createGoldenThreads(parent: pc.Entity, sources: pc.MeshInstance[]) {
  const app = (parent.findComponent("render") as pc.RenderComponent | null)?.system.app;
  if (!app || !sources.length) return null;
  const bounds = sources[0].aabb.clone();
  for (const source of sources.slice(1)) bounds.add(source.aabb);
  const { center, halfExtents: extent } = bounds;
  let disposed = false;
  return {
    update(progress: number) {
      if (disposed) return;
      const fade = Math.min(1, progress / 0.12) * Math.min(1, (1 - progress) / 0.24);
      const points: pc.Vec3[] = [], colors: pc.Color[] = [];
      for (let strand = 0; strand < 3; strand++) {
        const sample = (t: number) => {
          const angle = strand * 2.094 + t * 3.6 + progress * 0.55;
          const radius = 1.15 + Math.sin(t * Math.PI) * 0.35;
          points.push(new pc.Vec3(center.x + Math.cos(angle) * extent.x * radius,
            center.y - extent.y + extent.y * (0.15 + t * 3.5),
            center.z + Math.sin(angle) * Math.max(extent.z, extent.y * 0.5) * radius));
          const glint = Math.exp(-Math.pow((t - ((progress * 1.7 + strand * 0.17) % 1)) / 0.055, 2));
          colors.push(new pc.Color(0.9 + glint * 0.1, 0.64 + glint * 0.24, 0.25 + glint * 0.4, fade * 0.85));
        };
        for (let step = 0; step < 56; step++) { sample(step / 56); sample((step + 1) / 56); }
      }
      app.drawLines(points, colors, false);
    },
    dispose() { disposed = true; },
  };
}
