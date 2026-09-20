import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { galleryRooms, inspectRoomPackages } from "./shared-room-assets.ts";

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

test("fresh checkout omits unavailable local rooms without changing the Gaussian default", async () => fixture(async root => {
  await room(root, "cg-arch-interior", true, false);
  await room(root, "haussmann-apartment", true, false);
  await room(root, "studio-11", true, false);
  const result = await inspectRoomPackages(root);
  assert.equal(result.defaultRoomId, "haussmann-apartment");
  assert.deepEqual([...result.packages.keys()], ["empty-room"]);
  assert.equal(result.warnings.length, 3);
  assert.ok(result.warnings.some(warning => /Room haussmann-apartment is not packaged: local assets are missing/.test(warning)));
}));

test("provisioned Gaussian room is the default while the mesh package remains available", async () => fixture(async root => {
  await room(root, "haussmann-apartment", true, true);
  await room(root, "cg-arch-interior", true, true);
  const result = await inspectRoomPackages(root);
  assert.equal(result.defaultRoomId, "haussmann-apartment");
  assert.equal(result.packages.get("haussmann-apartment")?.size, 4);
  assert.equal(result.packages.get("cg-arch-interior")?.size, 4);
  assert.deepEqual(result.warnings, []);
}));

test("available mesh assets do not silently replace missing Gaussian assets as the default", async () => fixture(async root => {
  await room(root, "haussmann-apartment", true, false);
  await room(root, "cg-arch-interior", true, true);
  const result = await inspectRoomPackages(root);
  assert.equal(result.defaultRoomId, "haussmann-apartment");
  assert.equal(result.packages.has("haussmann-apartment"), false);
  assert.equal(result.packages.get("cg-arch-interior")?.size, 4);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Room haussmann-apartment is not packaged/);
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

test("floor aliases share only the canonical visual and remain optional without the download", async () => fixture(async root => {
  await room(root, "tower", true, false);
  await room(root, "floor", true, false);
  const writeAlias = async (owner: string, visualUrl: string) => writeFile(join(root, "floor", "manifest.json"), JSON.stringify({
    room: { roomId: "floor", scan: { visualUrl } }, spatialFile: "spatial.json", sharedVisualRoomId: owner,
  }));
  await writeAlias("tower", "/rooms/tower/assets/room.glb");
  assert.equal((await inspectRoomPackages(root)).packages.has("floor"), false);
  await room(root, "tower", true, true);
  const files = (await inspectRoomPackages(root)).packages.get("floor")!;
  assert.equal(files.get("/rooms/tower/assets/room.glb"), join(root, "tower/assets/room.glb"));
  assert.equal(files.has("/rooms/tower/spatial.json"), false);
  await writeAlias("tower", "/rooms/tower/assets/private.glb");
  await assert.rejects(inspectRoomPackages(root), /Invalid shared visual reference/);
  await writeAlias("../tower", "/rooms/tower/assets/room.glb");
  await assert.rejects(inspectRoomPackages(root), /Invalid shared visual owner/);
}));

test("shared visual aliases cannot chain or bypass symlink checks", async () => fixture(async root => {
  await room(root, "tower", true, true);
  await room(root, "floor", true, false);
  await writeFile(join(root, "floor/manifest.json"), JSON.stringify({room: {roomId: "floor", scan: {visualUrl: "/rooms/tower/assets/room.glb"}}, spatialFile: "spatial.json", sharedVisualRoomId: "tower"}));
  await rm(join(root, "tower/assets/room.glb"));
  await symlink(join(root, "empty-room/room.glb"), join(root, "tower/assets/room.glb"));
  await assert.rejects(inspectRoomPackages(root), /Unsafe room asset/);
  await writeFile(join(root, "tower/manifest.json"), JSON.stringify({room: {roomId: "tower", scan: {visualUrl: "/rooms/tower/assets/room.glb"}}, spatialFile: "spatial.json", sharedVisualRoomId: "floor"}));
  await assert.rejects(inspectRoomPackages(root), /Invalid shared visual reference/);
}));

test("the gallery lists every public room and marks the ones this machine cannot open", () => {
  const room = (id: string) => ({ id, title: id, description: "", thumbnail: "" });
  const listed = galleryRooms([room("empty-room"), room("cg-arch-interior")], new Set(["empty-room"]));
  assert.deepEqual(listed.map(entry => [entry.id, entry.packaged]), [["empty-room", true], ["cg-arch-interior", false]],
    "an unprovisioned room stays in the list, so its card can say so instead of the room vanishing or opening into nothing");
});
