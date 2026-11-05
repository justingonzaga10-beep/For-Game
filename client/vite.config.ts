import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API = process.env.INKWAVE_API ?? "http://localhost:3001";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // In dev the client talks to the game server through Vite, so the browser sees one origin.
    proxy: { "/socket.io": { target: API, ws: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});
