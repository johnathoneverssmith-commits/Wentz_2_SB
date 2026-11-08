import { defineConfig, devices } from "@playwright/test";

/**
 * Visual / accessibility audit harness. Not part of CI and not part of `npm run e2e`: run it with
 * `npm run audit:visual` (see e2e-audit/README.md). One worker, Chromium, the same sealed network as the functional suite.
 */
export default defineConfig({
  testDir: "./specs",
  globalSetup: "./support/global-setup.ts",
  outputDir: "./test-results",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "./test-results/report.json" }]],
  use: { trace: "off", screenshot: "off", video: "off" },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.E2E_BROWSER_CHANNEL || undefined,
        // for machines whose Chromium is not the build this Playwright version downloads (e.g. /opt/pw-browsers/chromium)
        launchOptions: process.env.AUDIT_CHROMIUM_PATH ? { executablePath: process.env.AUDIT_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
      },
    },
  ],
});
