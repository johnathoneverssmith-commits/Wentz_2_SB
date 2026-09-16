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
    /**
     * A league fixture builds a full 32-team pool, and several tests here
     * simulate whole seasons on top of that.
     *
     * 30s was enough when each file was timed on its own and too tight once
     * they run in parallel on a busy machine: the same three tests failed and
     * passed run to run, at 32-48s against a 30s limit, with nothing wrong.
     * A test that fails only when the machine is loaded teaches people to
     * re-run rather than to read, which is how a real failure gets waved
     * through. These are slow because they do a lot, so they are allowed to
     * be slow; anything that hangs still fails, just later.
     */
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
