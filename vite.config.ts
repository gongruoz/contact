import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [basicSsl()],
  root: ".",
  build: { outDir: "dist" },
  server: { host: true },
});
