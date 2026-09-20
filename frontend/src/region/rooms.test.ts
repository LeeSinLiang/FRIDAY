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
import { openingZone } from "./geometry";
import { maskToPixels } from "./maskPixels";
import { openingsFor } from "./roomOpenings";
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
  assert.match(source, /maskToPixels\(mask, LIT, texture\.lock\(\)/, "pixels come from the region module's maskToPixels, rows in mask order");
  assert.doesNotMatch(source, /countZ - 1 - iz/, "never reverse the rows here: that mirrored every region front to back (see maskPixels.ts)");
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

const cgWithWindow: Scene = { ...cgScene, openings: openingsFor("cg-arch-interior") };
const NEAR_W1 = { k: "near", ref: { kind: "window", id: "w1" } } as const;
const FOUR_FEET = { k: "distance_min", ref: { kind: "any_wall" }, mm: 1219 } as const;

test("the Cg Arch room's window is the one measured from its model, on the north wall, inside that wall", () => {
  const [w1, ...others] = openingsFor("cg-arch-interior")!;
  assert.equal(others.length, 0);
  assert.deepEqual([w1.id, w1.kind, w1.wall, w1.startCm, w1.widthCm, w1.sillCm], ["w1", "window", "n", 19.5, 280, 7.5]);
  const walls = wallBounds(cgRoom);
  assert.ok(w1.startCm >= 0 && w1.startCm + w1.widthCm <= walls.maxX - walls.minX, "the window lies within its wall");
  // Wall-relative in, scene coordinates out: x 806.5..1086.5 is where the glass node sits in the model.
  assert.deepEqual(openingZone(cgRoom, w1, 0), { minX: 806.5, maxX: 1086.5, minZ: 180, maxZ: 180 });
  assert.equal(openingsFor("empty-room"), undefined, "an unmeasured room says so instead of inventing a window");
});

test("HERO, whole sentence: by the window AND 4 feet from any wall, in the real room", () => {
  const herrakra = listingToProduct(listing("ikea-405.355.47"));
  const solution = solve(cgWithWindow, { product: herrakra }, [NEAR_W1, FOUR_FEET]);
  assert.deepEqual(solution.dropped, [], "the room describes its window now, so no clause is set aside");
  // By hand: 121.9 cm off every wall leaves x 945..960 (4 columns) unturned, 945..965 (5) turned; "near" reaches
  // 75 cm past that wall's own clearance, which leaves 15 rows from the first legal one. 4 x 15 and 5 x 15.
  assert.deepEqual(solution.legalCounts, [60, 75, 60, 75]);
  const without = solve(cgWithWindow, { product: herrakra }, [FOUR_FEET]).legalCounts;
  assert.deepEqual(without, [220, 265, 220, 265], "the window clause is what narrows it");
  const mask = solution.masks[1];
  for (let iz = 0; iz < mask.shape[1]; iz++) for (let ix = 0; ix < mask.shape[0]; ix++) {
    if (mask.data[iz * mask.shape[0] + ix] !== 1) continue;
    const z = mask.originCm[1] + iz * 5;
    assert.ok(z <= 410, `a lit centre at z = ${z} is not by the window`);
  }
});

test("a measured sill replaces the assumed one: floor-to-ceiling glass is blocked by a chair", () => {
  const herrakra = listingToProduct(listing("ikea-405.355.47")); // 73 cm tall: under the assumed 90 cm sill, over the real 7.5 cm one
  const blocking = [{ k: "not_blocking", ref: { kind: "window", id: "w1" } }] as const;
  const measured = solve(cgWithWindow, { product: herrakra }, [...blocking]).legalCounts;
  const assumed = solve({ ...cgWithWindow, openings: cgWithWindow.openings!.map(({ sillCm: _, ...o }) => o) }, { product: herrakra }, [...blocking]).legalCounts;
  const free = solve(cgWithWindow, { product: herrakra }, []).legalCounts;
  assert.deepEqual(assumed, free, "under an assumed 90 cm sill a 73 cm chair blocks nothing");
  for (let turn = 0; turn < 4; turn++) assert.ok(measured[turn] < free[turn], "with the real sill the strip in front of the glass is excluded");
});


test("maskToPixels keeps mask order: pixel row 0 is z = 0, and only free samples are lit", () => {
  const lit = [99, 186, 140, 150] as const;
  const mask = solve(cgWithWindow, { product: listingToProduct(listing("ikea-405.355.47")) }, [NEAR_W1, FOUR_FEET]).masks[1];
  const [countX, countZ] = mask.shape, pixels = maskToPixels(mask, lit);
  assert.equal(pixels.length, countX * countZ * 4);
  let litRows: number[] = [], litCount = 0;
  for (let iz = 0; iz < countZ; iz++) for (let ix = 0; ix < countX; ix++) {
    const at = (iz * countX + ix) * 4, isLit = pixels[at + 3] !== 0;
    assert.equal(isLit, mask.data[iz * countX + ix] === 1, `pixel (${ix}, ${iz}) must mirror the mask sample at the SAME row`);
    if (isLit) { litCount++; if (!litRows.includes(iz)) litRows.push(iz); assert.deepEqual([...pixels.slice(at, at + 4)], [...lit]); }
  }
  assert.equal(litCount, 75);
  // The hero patch is by the window, z 340..410 of an 844 cm deep room: nowhere near its own front-to-back mirror
  // (z 434..504). A reversed row order would put every lit row past the middle, which is how the bug looked.
  assert.deepEqual([Math.min(...litRows) * 5, Math.max(...litRows) * 5], [340, 410]);
  assert.ok(Math.max(...litRows) < countZ / 2, "lit rows stay in the near half, on the window's side");
  assert.throws(() => maskToPixels(mask, lit, new Uint8Array(8)), /does not match/);
});
