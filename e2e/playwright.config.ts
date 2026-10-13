import { defineConfig, devices } from "@playwright/test";

/**
 * Solo-browser proof of concept. One worker, Chromium, nothing shared between tests.
 *
 * The browser is Playwright's own Chromium (`npx playwright install chromium`). To use a Chrome that is already
 * installed instead, set E2E_BROWSER_CHANNEL=chrome. Either way the browser can only reach the temporary UI server
 * this run starts (support/guard.ts); no deployed site, account or API is ever contacted.
 */
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./support/global-setup.ts",
  outputDir: "./test-results",
  workers: 1,
  fullyParallel: false,
  retries: 0, // a test that needs a retry to pass is flaky, which is a failure here
  forbidOnly: Boolean(process.env.CI),
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: process.env.E2E_REPORT ?? "./test-results/report.json" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: process.env.E2E_BROWSER_CHANNEL || undefined },
    },
  ],
});
