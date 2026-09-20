import assert from "node:assert/strict";
import test from "node:test";
import feed from "../../../backend/catalogue/data/listings.json";
import fixtures from "../../../shared/scene-fixtures.json";
import { searchParams } from "../catalogue/api";
import type { Listing } from "../lib/types";
import { validatePlacement } from "../scene/placement";
import type { Instance, Product, Room } from "../scene/types";
import cgArch from "../../../shared/rooms/cg-arch-interior/manifest.json";
import cgArchSpatial from "../../../shared/rooms/cg-arch-interior/spatial.json";
import { listingToProduct, wallBounds, wallRect } from "./boundary";
import { solve } from "./solve";
import type { Scene } from "./types";

const listing = (id: string) => ({ ...feed.items.find((item) => item.id === id), thumb_url: "" }) as Listing;
const studio = fixtures.rooms.studio;
const scene: Scene = { room: studio.room as Room, products: fixtures.products as Product[], instances: studio.instances as Instance[] };

test("the studio preset is a valid, furnished, genuinely tight room", () => {
  assert.deepEqual([scene.room.widthCm, scene.room.depthCm], [260, 200]);
  for (const instance of scene.instances)
    assert.equal(validatePlacement(scene.room, scene.products, scene.instances, instance.instanceId, instance.pose).valid, true, instance.instanceId);
});

test("DEMO: in the studio a 3-seat sofa is refused, with the reason, and an armchair still fits", () => {
  const sofa = solve(scene, { product: listingToProduct(listing("ikea-291.292.29")) }, []);
  assert.equal(sofa.bestYawIndex, -1);
  assert.equal(sofa.whyNothingFits, "there is no free floor big enough for its 218 × 88 cm footprint");
  const spaced = solve(scene, { product: listingToProduct(listing("ikea-291.292.29")) }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 914 }]);
  assert.equal(spaced.whyNothingFits, "there is no free floor big enough for its 218 × 88 cm footprint");
  const emptyStudio = solve({ ...scene, instances: [] }, { product: listingToProduct(listing("ikea-291.292.29")) }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 914 }]);
  // Turned sideways it is 88 cm across: 88 + 2 x 91.4 = 271 against 260. The other way is far worse
  // (271 against 200 of depth), and the explanation reports the nearer miss.
  assert.equal(emptyStudio.whyNothingFits, "needs 271 cm of width, this room has 260 cm");
  const poang = solve(scene, { product: listingToProduct(listing("ikea-193.025.39")) }, []);
  assert.ok(poang.bestYawIndex >= 0 && poang.legalCounts.every((count) => count > 0));
});

test("find clauses become search params, repeating a param when a kind repeats", () => {
  assert.equal(searchParams([
    { k: "text", q: "wing" }, { k: "category", value: "armchair" }, { k: "price_max", cents: 40000 },
    { k: "material", value: "oak" }, { k: "material", value: "steel" }, { k: "colour", hex: "#3f7d4e" }, { k: "fits_w_max", mm: 900 },
  ]).toString(), "limit=12&q=wing&category=armchair&price_max=40000&material=oak&material=steel&colour=%233f7d4e&fits_w_mm=900");
});

test("the renderer stays in one file: nothing else in the region module imports three or r3f", async () => {
  const { readdir, readFile } = await import("node:fs/promises");
  const directory = new URL("../../src/region/", `file://${process.cwd()}/src/region/`);
  const offenders: string[] = [];
  for (const name of await readdir(directory)) {
    if (!/\.tsx?$/.test(name) || name === "FloorOverlay.tsx") continue;
    const source = await readFile(new URL(name, directory), "utf8");
    if (/from\s+["'](three|@react-three\/[^"']+|playcanvas)["']/.test(source)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});

test("the overlay writes uniforms through the live material, and leaves no GPU setting to a default", async () => {
  // three.js clones a ShaderMaterial's uniforms. Writing to the object that was passed in changes
  // nothing on screen: the first version did that, so its fit count changed on R and its drawing
  // did not. This cannot be rendered under node, so it pins the source instead.
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("FloorOverlay.tsx", `file://${process.cwd()}/src/region/`), "utf8");
  for (const uniform of ["uMask", "uShape", "uArmed"])
    assert.match(source, new RegExp(`live\\.${uniform}\\.value\\s*=`), `${uniform} must be written via material.current.uniforms`);
  assert.match(source, /material\.current\.uniforms\.uPulse\.value\s*=/);
  assert.doesNotMatch(source, /initialUniforms\.\w+\.value\s*=/, "writing to the initial uniforms object never reaches the GPU");
  assert.doesNotMatch(source, /\.uniforms\s*=(?!=)/, "replacing the uniforms object detaches the material from its program");
  assert.match(source, /precision mediump float;/);
  for (const setting of ["minFilter = NearestFilter", "magFilter = NearestFilter", "generateMipmaps = false", "wrapS = ClampToEdgeWrapping", "wrapT = ClampToEdgeWrapping", "unpackAlignment = 1"])
    assert.ok(source.includes(setting), `texture ${setting} must be explicit`);
});

test("the PlayCanvas overlay stays outside the region module, and is the only other file that may touch a renderer for it", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("regionOverlay.ts", `file://${process.cwd()}/src/scene/playcanvas/`), "utf8");
  assert.ok(source.includes(["from", '"playcanvas"'].join(" ")), "this is the file that imports the engine"); // spelled in two parts so the guard above does not flag this test
  assert.match(source, /from "\.\.\/\.\.\/region\/(grid|types)"/, "it consumes the region module's mask; the dependency points one way");
  for (const setting of ["minFilter: pc.FILTER_NEAREST", "magFilter: pc.FILTER_NEAREST", "mipmaps: false", "addressU: pc.ADDRESS_CLAMP_TO_EDGE", "addressV: pc.ADDRESS_CLAMP_TO_EDGE"])
    assert.ok(source.includes(setting), `texture ${setting} must be explicit`);
  assert.match(source, /!== FREE\) continue/, "only free samples are lit; unknown and blocked stay transparent");
});

const cgRoom = { ...(cgArch.room as unknown as Room), spatial: cgArchSpatial as Room["spatial"] };
const cgScene: Scene = { room: cgRoom, products: [], instances: [] };

test("a prepared room's walls are the edges of its free floor, not its modelled shell", () => {
  assert.deepEqual([cgRoom.widthCm, cgRoom.depthCm], [1158.01, 844.01]);
  assert.deepEqual(wallBounds(cgRoom), { minX: 787, maxX: 1121, minZ: 180, maxZ: 760 });
  assert.deepEqual(wallRect(cgRoom, "w"), { minX: 787, maxX: 787, minZ: 180, maxZ: 760 });
  assert.deepEqual(wallBounds(scene.room), { minX: 0, maxX: 260, minZ: 0, maxZ: 200 }); // a fixture room is itself
});

test("HERO: '5 feet from any wall' does not fit the Cg Arch living room, and says why; 3 feet does", () => {
  const poang = listingToProduct(listing("ikea-193.025.39"));
  const five = solve(cgScene, { product: poang }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 1524 }]);
  assert.deepEqual(five.legalCounts, [0, 0, 0, 0]);
  // Measured to the 1158 x 844 shell this used to PASS, for the wrong reason.
  assert.equal(five.whyNothingFits, "needs 373 cm of width, this room has 334 cm");
  const three = solve(cgScene, { product: poang }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 914 }]);
  assert.ok(three.bestYawIndex >= 0);
  for (const mask of three.masks) for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
    if (mask.data[iz * mask.shape[0] + ix] !== 1) continue;
    const x = ix * 5, z = iz * 5, turned = Math.abs(Math.sin(mask.yawRad)) > 0.5, [ex, ez] = turned ? [41, 34] : [34, 41];
    assert.ok(x - ex >= 787 + 91.4 - 1e-6 && x + ex <= 1121 - 91.4 + 1e-6 && z - ez >= 180 + 91.4 - 1e-6 && z + ez <= 760 - 91.4 + 1e-6, `${x},${z}`);
  }
});

test("HERO, as spoken: '4 feet from any wall' leaves a usable region in the Cg Arch living room", () => {
  // Chosen over 5 feet (nothing fits, 334 cm wide) and 3 feet (over a thousand positions, no visible narrowing).
  const four = (id: string) => solve(cgScene, { product: listingToProduct(listing(id)) }, [{ k: "distance_min", ref: { kind: "any_wall" }, mm: 1219 }]).legalCounts;
  assert.deepEqual(four("ikea-405.355.47"), [220, 265, 220, 265]); // HERRÅKRA, the one with a real model
  assert.deepEqual(four("ikea-193.025.39"), [255, 106, 255, 106]); // POÄNG
});
