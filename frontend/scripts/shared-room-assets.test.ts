import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectRoomPackages } from "./shared-room-assets.ts";

async function fixture(run: (root: string) => Promise<void>) {
  const scratch = fileURLToPath(new URL("../../.scratch/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "room-packaging-"));
  try { await room(root, "empty-room", false, true); await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

async function room(root: string, name: string, local: boolean, available: boolean) {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const relative = local ? "assets/room.glb" : "room.glb";
  await writeFile(join(directory, "manifest.json"), JSON.stringify({ room: { roomId: name, scan: {
    visualUrl: `/rooms/${name}/${relative}`, surfaceUrl: `/rooms/${name}/${relative}`,
  } }, spatialFile: "spatial.json" }));
  await writeFile(join(directory, "spatial.json"), "{}");
  await writeFile(join(directory, "license.txt"), "Fixture license");
  if (available) {
    await mkdir(join(directory, local ? "assets" : "."), { recursive: true });
    await writeFile(join(directory, relative), "GLB fixture bytes");
  }
}

test("fresh checkout omits whole unavailable local rooms and selects tracked fallback", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, false);
  await room(root, "studio-11", true, false);
  const result = await inspectRoomPackages(root);
  assert.equal(result.defaultRoomId, "empty-room");
  assert.deepEqual([...result.packages.keys()], ["empty-room"]);
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /local assets are missing/);
}));

test("complete locally provisioned Cg Arch package becomes the default", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, true);
  const result = await inspectRoomPackages(root);
  assert.equal(result.defaultRoomId, "cg-arch-interior");
  assert.equal(result.packages.get("cg-arch-interior")?.size, 4);
  assert.deepEqual(result.warnings, []);
}));

test("missing required metadata is not treated as an optional asset", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, false);
  await rm(join(root, "cg-arch-interior", "license.txt"));
  await assert.rejects(inspectRoomPackages(root), /ENOENT/);
}));

test("unsafe references fail even when another local asset is absent", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, false);
  await writeFile(join(root, "cg-arch-interior", "manifest.json"), JSON.stringify({
    room: { roomId: "cg-arch-interior", scan: { visualUrl: "/rooms/cg-arch-interior/assets/missing.glb", surfaceUrl: "/rooms/cg-arch-interior/../outside.glb" } }, spatialFile: "spatial.json",
  }));
  await assert.rejects(inspectRoomPackages(root), /Invalid runtime room asset/);
}));

test("dangling symlink downloads fail rather than silently selecting fallback", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, false);
  await mkdir(join(root, "cg-arch-interior", "assets"));
  await symlink(join(root, "nonexistent.glb"), join(root, "cg-arch-interior", "assets", "room.glb"));
  await assert.rejects(inspectRoomPackages(root), /Unsafe room asset/);
}));
