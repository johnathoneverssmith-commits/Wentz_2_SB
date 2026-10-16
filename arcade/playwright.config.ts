import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e", outputDir: "./test-results", workers: 1, retries: 0,
  forbidOnly: Boolean(process.env.CI), timeout: 30_000,
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  use: {
    ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5184",
    channel: process.env.E2E_BROWSER_CHANNEL || undefined,
    serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure",
  },
  webServer: {
    command: "node ../ui-source/node_modules/vite/bin/vite.js --config vite.config.ts --configLoader runner",
    url: "http://127.0.0.1:5184", reuseExistingServer: false, timeout: 30_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  },
});
