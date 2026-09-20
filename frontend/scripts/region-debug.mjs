// Writes debug SVGs of the region solver for the shared fixture room. Usage: npm run region:debug [outDir]
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outDir = resolve(process.argv[2] ?? "region-debug");
const directory = await mkdtemp(join(tmpdir(), "friday-region-"));
try {
  const bundle = join(directory, "debug.mjs");
  await build({ entryPoints: ["src/region/debugScenes.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle,
    define: { "import.meta.env.VITE_SCENE_UNIT_CM": "5" } });
  await mkdir(outDir, { recursive: true });
  const { writeDebugScenes } = await import(pathToFileURL(bundle).href);
  for (const line of await writeDebugScenes(outDir)) console.log(line);
} finally {
  await rm(directory, { recursive: true, force: true });
}
