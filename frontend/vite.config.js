import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/* The app is served at /site/ next to /web/ (the map and Pathfinder), by
   server/server.py or any static host. `npm run build` writes it to ../site.
   During `npm run dev`, /api and /web come from the Python server. */
const API = process.env.BAC_SERVER || "http://127.0.0.1:8765";

/* The service worker precaches the built files, whose names carry a content
   hash, so their list is written into sw.js at build time. */
function serviceWorker() {
  const template = fileURLToPath(new URL("./sw-template.js", import.meta.url));
  return {
    name: "bac-maps-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => /\.(js|css|html)$/.test(f));
      const source = readFileSync(template, "utf8").replace("/* BUILT_FILES */", built.map((f) => JSON.stringify(f)).join(",\n  "));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    }
  };
}

export default defineConfig({
  base: "/site/",
  plugins: [react(), serviceWorker()],
  build: {
    outDir: "../site",
    emptyOutDir: true,
    rollupOptions: { input: { main: "index.html", login: "login.html" } }
  },
  server: {
    port: 5173,
    proxy: { "/api": API, "/web": API }
  }
});
