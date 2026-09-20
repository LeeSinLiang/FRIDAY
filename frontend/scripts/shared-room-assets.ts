import { createReadStream } from "node:fs";
import { readdir, realpath, lstat, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../../shared/rooms/", import.meta.url));
const prefix = "/rooms/";
const mime: Record<string, string> = { ".sog": "application/octet-stream", ".glb": "model/gltf-binary", ".bin": "application/octet-stream", ".json": "application/json", ".txt": "text/plain", ".webp": "image/webp", ".png": "image/png" };
const roomId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const inside = (base: string, path: string) => { const part = relative(base, path); return part !== ".." && !part.startsWith("../") && !part.startsWith("..\\") && !isAbsolute(part); };

async function checkedFile(path: string, assetRoot = root) {
  if (!inside(assetRoot, path)) throw Error(`Unsafe room asset path: ${path}`);
  // A dangling symlink must fail validation, not masquerade as an optional download.
  const parts = relative(assetRoot, path).split(/[\\/]/);
  let cursor = assetRoot;
  for (let i = 0; i < parts.length; i++) {
    cursor = resolve(cursor, parts[i]);
    const info = await lstat(cursor);
    if (info.isSymbolicLink() || (i < parts.length - 1 ? !info.isDirectory() : !info.isFile()))
      throw Error(`Unsafe room asset (symlink or wrong file type): ${cursor}`);
  }
  const [actual, actualRoot] = await Promise.all([realpath(path), realpath(assetRoot)]);
  // Resolve symlinks before opening, including aliases to raw files inside the room.
  if (!inside(actualRoot, actual) || relative(actualRoot, actual) !== relative(assetRoot, path))
    throw Error(`Unsafe room asset: ${path}`);
  const info = await lstat(actual);
  return { actual, info };
}

/** The same manifest allowlist controls development HTTP and production packaging. */
async function roomFiles(name: string, assetRoot = root): Promise<Map<string, string>> {
  if (!roomId.test(name)) throw Object.assign(Error("Unknown room"), { code: "ENOENT" });
  const manifestPath = resolve(assetRoot, name, "manifest.json");
  const { actual } = await checkedFile(manifestPath, assetRoot);
  const manifest = JSON.parse(await readFile(actual, "utf8"));
  if (manifest.room?.roomId !== name || typeof manifest.spatialFile !== "string" || typeof manifest.room?.scan?.visualUrl !== "string")
    throw Error(`Invalid prepared room manifest: ${manifestPath}`);
  const roomPrefix = `${prefix}${name}/`;
  const files = new Map<string, string>();
  const urls = [`${roomPrefix}manifest.json`, `${roomPrefix}license.txt`, `${roomPrefix}${manifest.spatialFile}`,
    manifest.room.scan.visualUrl, ...(manifest.room.scan.surfaceUrl === undefined ? [] : [manifest.room.scan.surfaceUrl])];
  for (const url of urls) {
    if (typeof url !== "string" || !url.startsWith(roomPrefix) || /[\\?#%]/.test(url) ||
      url.slice(1).split("/").some(part => !part || part.startsWith(".")) || !mime[extname(url)] || basename(url).toLowerCase() === "preparation.json")
      throw Error(`Invalid runtime room asset reference: ${String(url)}`);
    const path = resolve(assetRoot, url.slice(prefix.length));
    if (!inside(resolve(assetRoot, name), path)) throw Error(`Room asset must belong to ${name}: ${url}`);
    files.set(url, path);
  }
  return files;
}

/** Only absent local downloads are optional; corrupt metadata and unsafe files are errors. */
export async function inspectRoomPackages(assetRoot = root) {
  const packages = new Map<string, Map<string, string>>();
  const warnings: string[] = [];
  for (const room of await readdir(assetRoot, { withFileTypes: true })) {
    if (room.name.startsWith(".")) continue;
    if (room.isSymbolicLink()) throw Error(`Unsafe room directory: ${room.name}`);
    if (!room.isDirectory()) continue;
    const files = await roomFiles(room.name, assetRoot);
    const missing: string[] = [];
    for (const [url, path] of files) {
      try { await checkedFile(path, assetRoot); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT" && url.startsWith(`${prefix}${room.name}/assets/`)) missing.push(url);
        else throw error;
      }
    }
    if (missing.length) warnings.push(`Room ${room.name} is not packaged: local assets are missing (${missing.join(", ")}). Provision this room's licensed assets and restart Vite or rebuild.`);
    else packages.set(room.name, files);
  }
  if (!packages.has("empty-room")) throw Error("The required tracked empty-room fallback is unavailable");
  return { packages, warnings, defaultRoomId: "haussmann-apartment" };
}

/** Stream prepared room assets; large source captures never enter a Vite bundle. */
export function sharedRoomAssets(): Plugin {
  let prepared: Awaited<ReturnType<typeof inspectRoomPackages>>;
  return {
    name: "friday-shared-room-assets",
    async config() {
      prepared = await inspectRoomPackages();
      return { define: { "import.meta.env.VITE_DEFAULT_ROOM_ID": JSON.stringify(prepared.defaultRoomId) } };
    },
    configResolved(config) {
      for (const warning of prepared.warnings) config.logger.warn(warning);
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        if (!["GET", "HEAD"].includes(request.method ?? "")) { response.statusCode = 405; response.end(); return; }
        try {
          const decoded = decodeURIComponent(url);
          const name = decoded.slice(prefix.length).split("/")[0];
          if (!roomId.test(name)) { response.statusCode = 404; response.end(); return; }
          const path = (await roomFiles(name)).get(decoded);
          if (!path) {
            response.statusCode = 404; response.end(); return;
          }
          const { actual, info } = await checkedFile(path);
          response.setHeader("Content-Type", mime[extname(path)]);
          response.setHeader("Content-Length", info.size);
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("X-Content-Type-Options", "nosniff");
          if (request.method === "HEAD") response.end();
          else { const stream = createReadStream(actual); stream.on("error", () => response.destroy()); response.on("close", () => stream.destroy()); stream.pipe(response); }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          response.statusCode = error instanceof URIError ? 400 : ["ENOENT", "ENOTDIR"].includes(code ?? "") ? 404 : 500;
          response.end();
        }
      });
    },
    async generateBundle() {
      for (const files of prepared.packages.values()) {
        for (const [url, path] of files) {
          const { actual } = await checkedFile(path);
          this.emitFile({ type: "asset", fileName: url.slice(1), source: await readFile(actual) });
        }
      }
    },
  };
}
