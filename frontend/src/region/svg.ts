// Top-down SVG of a solve, for checking correctness without a renderer. Pure: returns a string.
// North (z = 0) is drawn at the top, west (x = 0) at the left, 1 SVG unit = 1 cm.

import type { Instance, Pose, Product } from "../scene/types";
import { floorRegion } from "./floor";
import { openingZone } from "./geometry";
import { FREE, UNKNOWN, type Mask, type Opening, type Scene } from "./types";

const MARGIN_CM = 30;
const COLOURS = { lit: "#3fae6b", unknown: "#e0a030", wall: "#2b2b2b", item: "#8a8d8f", candidate: "#1f5fbf", door: "#b9542c", window: "#4aa3df" };

function corners(product: Product, pose: Pose): string {
  const c = Math.cos(pose.yawRad), s = Math.sin(pose.yawRad), hw = product.widthCm / 2, hd = product.depthCm / 2;
  // Same axes as the scene's placement check: local x -> (c, -s), local z -> (s, c).
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
    .map(([lx, lz]) => `${(pose.xCm + lx * c + lz * s).toFixed(1)},${(pose.zCm - lx * s + lz * c).toFixed(1)}`).join(" ");
}

/** One rect per horizontal run of equal cells, so a full room is a few hundred elements, not 12,000. */
function runs(mask: Mask, state: number, fill: string): string {
  const [countX, countZ] = mask.shape, size = mask.cellSizeCm, out: string[] = [];
  for (let iz = 0; iz < countZ; iz++) for (let ix = 0; ix < countX; ix++) {
    if (mask.data[iz * countX + ix] !== state) continue;
    const start = ix;
    while (ix + 1 < countX && mask.data[iz * countX + ix + 1] === state) ix++;
    const x = mask.originCm[0] + start * size - size / 2, z = mask.originCm[1] + iz * size - size / 2;
    out.push(`<rect x="${x}" y="${z}" width="${(ix - start + 1) * size}" height="${size}" fill="${fill}"/>`);
  }
  return out.join("");
}

function openingLine(scene: Scene, opening: Opening): string {
  // Through openingZone, so the drawing cannot disagree with what the solver excludes.
  const zone = openingZone(scene.room, opening, 0);
  return `<line x1="${zone.minX}" y1="${zone.minZ}" x2="${zone.maxX}" y2="${zone.maxZ}" stroke="${COLOURS[opening.kind]}" stroke-width="10"><title>${opening.kind} ${opening.id}</title></line>`;
}

export type SvgOptions = { title?: string; candidate?: { product: Product; pose: Pose } };

/** Room outline, openings, placed items, the lit region (green) and unobserved floor (amber). */
export function toSvg(scene: Scene, mask: Mask, options: SvgOptions = {}): string {
  const { widthCm: w, depthCm: d } = scene.room;
  // Every boundary piece of the floor: solid for a wall, dashed for a portal. Not a rectangle, unless the floor is one.
  const boundary = floorRegion(scene.room).edges.map((edge) => `<line x1="${edge.rect.minX}" y1="${edge.rect.minZ}" x2="${edge.rect.maxX}" y2="${edge.rect.maxZ}" stroke="${COLOURS.wall}" stroke-width="6"${edge.portalId ? ' stroke-dasharray="14 10" stroke-opacity="0.5"' : ""}/>`).join("");
  const product = (instance: Instance) => scene.products.find((p) => p.productId === instance.productId);
  const items = scene.instances.map((instance) => {
    const found = product(instance);
    return found ? `<polygon points="${corners(found, instance.pose)}" fill="${COLOURS.item}" fill-opacity="0.85" stroke="#000"><title>${instance.instanceId}</title></polygon>` : "";
  }).join("");
  const candidate = options.candidate
    ? `<polygon points="${corners(options.candidate.product, options.candidate.pose)}" fill="none" stroke="${COLOURS.candidate}" stroke-width="3" stroke-dasharray="8 5"/>`
    : "";
  const title = options.title ? `<text x="0" y="-10" font-family="monospace" font-size="14">${options.title.replace(/[<>&"]/g, "")}</text>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-MARGIN_CM} ${-MARGIN_CM} ${w + 2 * MARGIN_CM} ${d + 2 * MARGIN_CM}" style="max-width:100%;height:auto">`
    + `<rect x="${-MARGIN_CM}" y="${-MARGIN_CM}" width="${w + 2 * MARGIN_CM}" height="${d + 2 * MARGIN_CM}" fill="#fff"/>${title}`
    + `<g fill-opacity="0.55" shape-rendering="crispEdges">${runs(mask, FREE, COLOURS.lit)}${runs(mask, UNKNOWN, COLOURS.unknown)}</g>`
    + boundary
    + (scene.openings ?? []).map((opening) => openingLine(scene, opening)).join("") + items + candidate + `</svg>`;
}
