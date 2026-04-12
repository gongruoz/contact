import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
  root: ".",
  build: { outDir: "dist" },
  server: { host: true },
  /** Use patched `node_modules/tinypeer` directly — pre-bundling caches a copy under `.vite/deps` that can ignore patch-package until cache clear. */
  optimizeDeps: {
    exclude: ["tinypeer"],
  },
});
