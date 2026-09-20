import { attachAt, availableSupports, worldToLocal, localToWorld } from "../supports";
import type { Attachment, Instance, Pose, Product } from "../types";
import { furnitureHit, intersectFloor, type SceneRay } from "./interaction";

/** Pick the nearest reviewed horizontal face, including an exposed shelf inside an open cabinet. */
export function pickSupport(ray: SceneRay, instances: Instance[], products: Product[], yawRad: number, snap: boolean, exclude?: string): { pose: Pose; attachment?: Attachment } | null {
  const floor = intersectFloor(ray);
  let result: { pose: Pose; attachment?: Attachment } | null = floor ? { pose: { xCm: floor.x, zCm: floor.z, yawRad } } : null;
  let nearest = floor ? Math.hypot(floor.x-ray.origin.x, floor.y-ray.origin.y, floor.z-ray.origin.z) : Infinity;
  for (const { parent, profile, target } of availableSupports(instances, products)) {
    if (parent.instanceId === exclude) continue;
    const point = intersectFloor(ray, target.yCm);
    if (!point) continue;
    const distance = Math.hypot(point.x-ray.origin.x,point.y-ray.origin.y,point.z-ray.origin.z);
    const local = worldToLocal(parent.pose,{ xCm: point.x,zCm: point.z,yawRad });
    if (distance >= nearest || Math.abs(local.xCm-target.xCm)>target.widthCm/2 || Math.abs(local.zCm-target.zCm)>target.depthCm/2) continue;
    if (snap) { local.xCm=Math.round(local.xCm/5)*5;local.zCm=Math.round(local.zCm/5)*5; }
    const pose=localToWorld(parent.pose,{...local,yCm:target.yCm});
    result={pose,attachment:attachAt(parent,target,profile,pose)};nearest=distance;
  }
  if (result && !result.attachment && snap) { result.pose.xCm=Math.round(result.pose.xCm/5)*5;result.pose.zCm=Math.round(result.pose.zCm/5)*5; }
  if (result) {
    for (const instance of instances) {
      if (instance.instanceId === exclude) continue;
      const product=products.find(p=>p.productId===instance.productId) ?? instance.product;
      const hit=product ? furnitureHit(ray,instance,product) : null;
      if (hit && hit.distance < nearest - 1e-4) return null;
    }
  }
  return result;
}
