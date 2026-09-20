import registry from "../../../shared/placement-profiles.json";
import { productOf } from "./products";
import type { Attachment, Instance, Pose, Product } from "./types";

export type Solid = { xCm: number; yCm: number; zCm: number; widthCm: number; depthCm: number; heightCm: number };
export type SupportTarget = Solid & { id: string; label: string; kind: "surface" | "compartment" };
export type Profile = Pick<Solid, "widthCm" | "depthCm" | "heightCm"> & { productId: string; modelUrl: string; revision: string; modelSha256: string; solids: Solid[]; targets: SupportTarget[] };
export class SupportError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new SupportError(code, message); };
export const profileOf = (product: Product | undefined): Profile | undefined => product && registry.profiles.find(p =>
  p.productId === product.productId && p.modelUrl === product.modelUrl &&
  ["widthCm", "depthCm", "heightCm"].every(k => Math.abs(p[k as "widthCm"] - product[k as "widthCm"]) < 1e-6)) as Profile | undefined;

export function validAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== "object") return false;
  const a = value as Attachment;
  return typeof a.parentInstanceId === "string" && !!a.parentInstanceId && typeof a.profileRevision === "string" &&
    !!a.target && ["surface", "compartment"].includes(a.target.kind) && typeof a.target.id === "string" && !!a.target.id &&
    !!a.localPose && [a.localPose.xCm, a.localPose.zCm, a.localPose.yawRad].every(Number.isFinite);
}
export function localToWorld(parent: Pose, local: Pose): Pose {
  const c = Math.cos(parent.yawRad), s = Math.sin(parent.yawRad);
  return { xCm: parent.xCm + c * local.xCm + s * local.zCm,
    zCm: parent.zCm - s * local.xCm + c * local.zCm, yawRad: parent.yawRad + local.yawRad,
    yCm: (parent.yCm ?? 0) + (local.yCm ?? 0) };
}
export function worldToLocal(parent: Pose, world: Pose): Pose {
  const c = Math.cos(parent.yawRad), s = Math.sin(parent.yawRad), dx = world.xCm - parent.xCm, dz = world.zCm - parent.zCm;
  return { xCm: c * dx - s * dz, zCm: s * dx + c * dz, yawRad: world.yawRad - parent.yawRad };
}
export function attachmentTarget(attachment: Attachment, instances: Instance[], products: Product[]) {
  if (!validAttachment(attachment)) return fail("invalid_attachment", "Invalid support reference");
  const parent = instances.find(i => i.instanceId === attachment.parentInstanceId);
  if (!parent || parent.attachment) return fail("unsupported_target", "Choose a floor-standing support in this room");
  const profile = profileOf(productOf(parent, products));
  if (!profile) return fail("unsupported_target", "This model has no reviewed support surfaces");
  if (profile.revision !== attachment.profileRevision) return fail("stale_profile", "The support geometry changed. Choose the surface again");
  const target = profile.targets.find(t => t.id === attachment.target.id && t.kind === attachment.target.kind);
  if (!target) return fail("unsupported_target", "The support surface is unavailable");
  return { parent, profile, target };
}
/** Only the attachment determines elevation. Client-supplied Y is never authoritative. */
export function resolveAttachments(instances: Instance[], products: Product[]): Instance[] {
  return instances.map(item => {
    if (!item.attachment) {
      if ((item.pose.yCm ?? 0) !== 0) return fail("unsupported_height", "An elevated object needs a support");
      return item;
    }
    if (item.attachment.parentInstanceId === item.instanceId) return fail("unsupported_target", "An object cannot support itself");
    const { parent, target } = attachmentTarget(item.attachment, instances, products);
    const local = item.attachment.localPose;
    return { ...item, pose: localToWorld(parent.pose, { ...local, yCm: target.yCm }) };
  });
}
export function attachAt(parent: Instance, target: SupportTarget, profile: Profile, pose: Pose): Attachment {
  return { parentInstanceId: parent.instanceId, target: { kind: target.kind, id: target.id },
    profileRevision: profile.revision, localPose: worldToLocal(parent.pose, pose) };
}
/** A move without an explicit new support stays in the existing support frame. */
export function moveWithAttachments(instances: Instance[], products: Product[], id: string, pose: Pose, attachment?: Attachment | null): Instance[] {
  const next = instances.map(item => {
    if (item.instanceId !== id) return item;
    let a = attachment === undefined ? item.attachment : attachment ?? undefined;
    if (a && attachment === undefined) {
      const { parent } = attachmentTarget(a, instances, products);
      a = { ...a, localPose: worldToLocal(parent.pose, pose) };
    }
    const { attachment: _old, ...rest } = item;
    return { ...rest, pose: attachment === null ? { xCm: pose.xCm, zCm: pose.zCm, yawRad: pose.yawRad } : pose, ...(a ? { attachment: a } : {}) };
  });
  return resolveAttachments(next, products);
}
export function supportFit(item: Instance, product: Product, instances: Instance[], products: Product[]): void {
  if (!item.attachment) return;
  const { target } = attachmentTarget(item.attachment, instances, products);
  const p = item.attachment.localPose, c = Math.abs(Math.cos(p.yawRad)), s = Math.abs(Math.sin(p.yawRad));
  const ex = (c * product.widthCm + s * product.depthCm) / 2, ez = (s * product.widthCm + c * product.depthCm) / 2;
  if (Math.abs(p.xCm - target.xCm) + ex > target.widthCm / 2 + 1e-6 || Math.abs(p.zCm - target.zCm) + ez > target.depthCm / 2 + 1e-6)
    fail("support_overhang", "The whole object must fit on its support");
  if (target.kind === "compartment" && product.heightCm > target.heightCm + 1e-6)
    fail("outside_compartment", "The object is too tall for this compartment");
}
export function solidParts(item: Instance, product: Product): (Solid & { yawRad: number })[] {
  const solids = profileOf(product)?.solids ?? [{ xCm: 0, yCm: 0, zCm: 0, widthCm: product.widthCm, depthCm: product.depthCm, heightCm: product.heightCm }];
  return solids.map(b => ({ ...b, ...localToWorld(item.pose, { ...b, yawRad: 0 }), yCm: (item.pose.yCm ?? 0) + b.yCm }));
}
export function availableSupports(instances: Instance[], products: Product[]) {
  return instances.filter(i => !i.attachment).flatMap(parent => {
    const profile = profileOf(productOf(parent, products));
    return profile ? profile.targets.map(target => ({ parent, profile, target })) : [];
  });
}

/** Stable target IDs are opaque to the compiler; never infer geometry from a label. */
export const supportReferenceId = (parentId: string, targetId: string) => `${encodeURIComponent(parentId)}/${encodeURIComponent(targetId)}`;
export function supportForRef(ref: { kind: string; id?: string }, instances: Instance[], products: Product[]) {
  const matches = availableSupports(instances, products).filter(s => ref.kind === "instance"
    ? s.parent.instanceId === ref.id && s.target.kind === "surface"
    : s.target.kind === ref.kind && supportReferenceId(s.parent.instanceId, s.target.id) === ref.id);
  if (matches.length !== 1) return fail("unsupported_target", matches.length ? "Choose one named support surface" : "That support is unavailable in this room");
  return matches[0];
}
