// A placed item that the server has not confirmed yet. The room session only shows what the server
// accepted, so while a save is being retried this keeps the item on the floor, at true size.

import * as pc from "playcanvas";
import type { Pose, Product } from "../types";
import { cmToScene } from "../units";

type Runtime = { contentRoot: pc.Entity; disposed: boolean };

export type PendingGhost = { show(product: Product, pose: Pose): void; hide(): void; dispose(): void };

export function createPendingGhost(runtime: Runtime): PendingGhost {
  const material = new pc.StandardMaterial();
  material.blendType = pc.BLEND_NORMAL;
  material.opacity = 0.7;
  const entity = new pc.Entity("Unconfirmed placement");
  entity.addComponent("render", { type: "box", material, castShadows: false });
  entity.enabled = false;
  runtime.contentRoot.addChild(entity);
  return {
    show(product, pose) {
      if (runtime.disposed) return;
      const colour = new pc.Color(); colour.fromString(product.color);
      material.diffuse = colour; material.update();
      entity.setLocalScale(cmToScene(product.widthCm), cmToScene(product.heightCm), cmToScene(product.depthCm));
      entity.setLocalPosition(cmToScene(pose.xCm), cmToScene((pose.yCm ?? 0) + product.heightCm / 2), cmToScene(pose.zCm));
      entity.setLocalEulerAngles(0, pose.yawRad * pc.math.RAD_TO_DEG, 0);
      entity.enabled = true;
    },
    hide() { entity.enabled = false; },
    dispose() { entity.destroy(); material.destroy(); },
  };
}
