import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const root = fileURLToPath(new URL("../../shared/models/furniture/", import.meta.url));
const prefix = "/models/furniture/";
const mime: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ktx2": "image/ktx2",
};

function inside(path: string) {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** One canonical asset source for backend tooling and browser delivery. */
export function sharedFurnitureAssets(): Plugin {
  return {
    name: "friday-shared-furniture-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = request.url?.split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.statusCode = 405;
          response.setHeader("Allow", "GET, HEAD");
          response.end();
          return;
        }
        try {
          const name = decodeURIComponent(url.slice(prefix.length));
          const path = resolve(root, name);
          const contentType = mime[extname(path).toLowerCase()];
          if (!inside(path) || !contentType || name.split(/[\\/]/).some(part => part.startsWith("."))) {
            response.statusCode = 404;
            response.end();
            return;
          }
          const actual = await realpath(path);
          if (!inside(actual) || !(await stat(actual)).isFile()) {
            response.statusCode = 404;
            response.end();
            return;
          }
          const bytes = await readFile(actual);
          response.setHeader("Content-Type", contentType);
          response.setHeader("Content-Length", bytes.length);
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("X-Content-Type-Options", "nosniff");
          response.end(request.method === "HEAD" ? undefined : bytes);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          response.statusCode = error instanceof URIError ? 400 : code === "ENOENT" || code === "ENOTDIR" ? 404 : 500;
          response.end();
        }
      });
    },
    async generateBundle() {
      const visit = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const path = resolve(directory, entry.name);
          if (entry.isSymbolicLink()) throw new Error(`Furniture assets must be files, not symlinks: ${path}`);
          if (entry.isDirectory()) await visit(path);
          else if (entry.isFile() && mime[extname(path).toLowerCase()]) {
            this.emitFile({
              type: "asset",
              fileName: `models/furniture/${relative(root, path).split(sep).join("/")}`,
              source: await readFile(path),
            });
          }
        }
      };
      await visit(root);
    },
  };
}
