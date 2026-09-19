import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

/** Development-only delayed GLB for verifying pose changes and removal during loading. */
export function devModelFixtures(): Plugin {
  return {
    name: "friday-dev-model-fixtures",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__test/slow-model.glb", (request, response) => {
        const timer = setTimeout(async () => {
          if (response.destroyed) return;
          try {
            const data = await readFile(
              new URL(
                "../public/models/test-fixture/model.glb",
                import.meta.url,
              ),
            );
            response.setHeader("Content-Type", "model/gltf-binary");
            response.setHeader("Cache-Control", "no-store");
            response.end(data);
          } catch {
            response.statusCode = 500;
            response.end("Test model unavailable");
          }
        }, 5000);
        response.on("close", () => clearTimeout(timer));
      });
    },
  };
}
