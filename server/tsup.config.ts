import { defineConfig } from "tsup";

// Bundles the server plus the shared workspace package into one ESM file.
// Real npm dependencies (express, socket.io) stay external and load from node_modules.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: ["@inkwave/shared"],
});
