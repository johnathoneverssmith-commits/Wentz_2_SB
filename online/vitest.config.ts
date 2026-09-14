import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * The online server's tests. Separate from the engine's suite because they
 * need the `@/` alias into `ui-source` — the rules they exercise are the
 * client's, which is the entire point.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../ui-source/src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // a league fixture builds a full 32-team pool
    testTimeout: 30_000,
  },
});
