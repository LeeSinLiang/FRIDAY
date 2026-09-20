// "npm test" must mean every frontend test. A test file that nothing runs passes forever.
//
// Two ways a test file gets run: it is imported, directly or through another test file, from
// src/scene/all-tests.ts (the bundle scripts/test-scene.mjs builds), or it is named in package.json's
// "test" script. This fails for any *.test.* file on disk that is neither.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

const root = process.cwd(); // frontend/

async function testFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await testFiles(path));
    else if (/\.test\.(ts|tsx|mjs|js)$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function bundled(entry: string, seen = new Set<string>()): Promise<Set<string>> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const source = await readFile(join(root, entry), "utf8");
  for (const [, specifier] of source.matchAll(/^import\s+"(\.[^"]+)";?\s*$/gm)) {
    const target = relative(root, resolve(root, dirname(entry), specifier));
    for (const extension of [".ts", ".tsx"]) {
      try { await bundled(target + extension, seen); break; } catch { /* try the next extension */ }
    }
  }
  return seen;
}

test("every test file on disk is run by npm test", async () => {
  const onDisk = [...await testFiles("src"), ...await testFiles("scripts")].sort();
  const inBundle = await bundled("src/scene/all-tests.ts");
  const script: string = JSON.parse(await readFile(join(root, "package.json"), "utf8")).scripts.test;
  const unrun = onDisk.filter((file) => !inBundle.has(file) && !script.split(/\s+/).includes(file));
  assert.deepEqual(unrun, [], "add each of these to src/scene/all-tests.ts (or a test file it imports), or to the test script in package.json");
  assert.ok(onDisk.length >= 17, `expected to find the test files, found ${onDisk.length}`);
});
