import { fileURLToPath } from "node:url";
import { defineConfig } from "../ui-source/node_modules/vite/dist/node/index.js";

const root = fileURLToPath(new URL(".", import.meta.url));
export default defineConfig({
  root,
  envDir: false,
  base: "./",
  esbuild: { jsx: "automatic" },
  resolve: { alias: {
    "react-dom": fileURLToPath(new URL("../ui-source/node_modules/react-dom", import.meta.url)),
    react: fileURLToPath(new URL("../ui-source/node_modules/react", import.meta.url)),
  } },
  server: { host: "127.0.0.1", port: 5184, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true },
});
