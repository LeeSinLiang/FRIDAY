import * as pc from "playcanvas";

const STRANDS = 4;
const SEGMENTS = 48;
const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Temporary champagne silk sweeps through the room, then settles into the fabric. */
export function createGoldenThreads(parent: pc.Entity, sources: pc.MeshInstance[]) {
  const app = (parent.findComponent("render") as pc.RenderComponent | null)?.system.app;
  if (!app || !sources.length) return null;
  const bounds = sources[0].aabb.clone();
  for (const source of sources.slice(1)) bounds.add(source.aabb);
  const { center, halfExtents: extent } = bounds;
  // Keep the immediate-mode buffers for this short animation instead of creating
  // hundreds of vectors and colors on every frame.
  const points = Array.from({ length: STRANDS * SEGMENTS * 2 }, () => new pc.Vec3());
  const colors = Array.from({ length: points.length }, () => new pc.Color());
  const width = Math.max(extent.x, extent.z * 0.4);
  const depth = Math.max(extent.z, extent.x * 0.4);
  const height = extent.y * 2;
  let disposed = false;
  return {
    update(progress: number) {
      if (disposed || progress <= 0 || progress >= 1) return;
      const fade = smooth(progress / 0.16) * smooth((1 - progress) / 0.32);
      const head = smooth(progress / 0.64) * 1.18;
      let vertex = 0;
      for (let strand = 0; strand < STRANDS; strand++) {
        const phase = strand * 2.39996;
        const roomward = strand === STRANDS - 1;
        for (let step = 0; step < SEGMENTS; step++) {
          for (let edge = 0; edge < 2; edge++) {
            const t = (step + edge) / SEGMENTS;
            const arch = Math.sin(t * Math.PI);
            // Open, unequal arcs feel like trailing thread, not a spinning cage.
            const angle = phase + t * (2.65 + strand * 0.17) + arch * 0.22 + progress * 0.24;
            const radius = 1.08 + arch * (roomward ? 1.1 : 0.38);
            points[vertex].set(
              center.x + Math.cos(angle) * width * radius,
              center.y - extent.y + height * (0.06 + t * (1.08 + strand * 0.09))
                + arch * Math.sin(phase + t * 2.2) * height * 0.07,
              center.z + Math.sin(angle) * depth * radius,
            );
            const glint = Math.exp(-Math.pow((t - progress * 1.18 + strand * 0.06) / 0.08, 2));
            const taper = Math.pow(Math.max(0, arch), 0.65) * smooth((head - t) / 0.18);
            colors[vertex].set(0.84 + glint * 0.14, 0.65 + glint * 0.23, 0.35 + glint * 0.36,
              fade * taper * (roomward ? 0.3 : 0.7));
            vertex++;
          }
        }
      }
      app.drawLines(points, colors, true);
    },
    dispose() { disposed = true; },
  };
}
