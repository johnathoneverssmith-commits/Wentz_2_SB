import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const deploymentMetadata = {
  commit: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "local",
  branch: process.env.RENDER_GIT_BRANCH ?? "local",
  api: process.env.VITE_LEAGUE_API ?? "http://localhost:8788",
  builtAt: new Date().toISOString(),
};

export default defineConfig({
  // relative asset URLs so the built index.html works from file://
  base: "./",
  plugins: [
    react(),
    {
      name: "deployment-metadata",
      transformIndexHtml() {
        return Object.entries(deploymentMetadata).map(([name, content]) => ({
          tag: "meta",
          attrs: { name: `franchise-${name}`, content },
          injectTo: "head" as const,
        }));
      },
    },
    viteSingleFile(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
