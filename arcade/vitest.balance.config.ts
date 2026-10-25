import { defineConfig } from "vitest/config";

// The gameplay-balance suite is separate from the technical tests: `npm --prefix arcade run test:balance`.
export default defineConfig({ test: { include: ["balance/**/*.test.ts"], environment: "node", testTimeout: 120000 } });
