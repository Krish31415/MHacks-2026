import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

// Vite builds the React app into dist/. The Express server serves that folder
// in production, so the whole project ships as one Node service.
// In dev, Vite runs on 5173 and proxies /api to the Express server on 8787.

// WORKAROUND: Vite hard-rejects any file path that contains ":" -- see
// isFileLoadingAllowed() in vite/dist/node, which returns false on
// `filePath.includes(":")` BEFORE it ever checks the server.fs.allow list.
// So dev mode answers 403 for every request when the project directory name
// contains a colon (e.g. ".../Hackathons:Events/MHacks-2026"), and no
// `fs.allow` entry can rescue it. The only escape hatch is fs.strict = false,
// which is the branch that runs first. We relax it only when the project path
// actually has a colon, so normal checkouts keep Vite's strict default.
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const rootHasColon = projectRoot.includes(":");

const server: UserConfig["server"] = {
  port: 5173,
  proxy: {
    "/api": {
      target: "http://localhost:8787",
      changeOrigin: true,
    },
  },
};

if (rootHasColon) {
  server.fs = { strict: false };
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
