import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

// The engine tests need a full league. The generated pool is git-ignored, so
// a checkout without it (CI) plays them on a committed copy instead.
const fixture = resolve("test/fixtures/pool.json");
const haveLocalPool = existsSync(resolve("data/players.local.json"));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: haveLocalPool ? {} : { NFL_POOL_PATH: fixture },
    // whole simulated games and seasons: 5s was enough alone and timed out
    // under a full parallel run, failing a different test each time
    testTimeout: 30_000,
  },
});
