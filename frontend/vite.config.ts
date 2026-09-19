import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { devModelFixtures } from "./scripts/dev-model-fixtures";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, "..", ""), ...process.env };
  const sceneUnitCm = Number(env.SCENE_UNIT_CM ?? 5);
  if (!Number.isFinite(sceneUnitCm) || sceneUnitCm <= 0) {
    throw new Error("SCENE_UNIT_CM must be a finite positive number");
  }
  return {
    define: {
      "import.meta.env.VITE_SCENE_UNIT_CM": JSON.stringify(sceneUnitCm),
    },
    plugins: [react(), devModelFixtures()],
    server: {
      host: "127.0.0.1",
      port: Number(env.FRONTEND_PORT || 5173),
      strictPort: true,
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${env.BACKEND_PORT || 8000}`,
          // Preserve the browser Host so Django can verify same-origin CSRF.
          changeOrigin: false,
        },
      },
    },
  };
});
