import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

/** COMP-006 harness project: same `@/` alias as online/vitest.config.ts, no globalSetup (no database needed). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../../ui-source/src", import.meta.url)) } },
  test: { include: ["*.test.ts"], environment: "node", testTimeout: 600_000, hookTimeout: 600_000 },
});
