import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // whole simulated games and seasons: 5s was enough alone and timed out
    // under a full parallel run, failing a different test each time
    testTimeout: 30_000,
  },
});
