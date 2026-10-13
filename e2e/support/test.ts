/**
 * The test object every spec uses. What it guarantees, per test:
 *   - a brand-new browser context, so a fresh localStorage (nothing carries over between tests);
 *   - service workers blocked, and every request outside this run's UI origin aborted (see guard.ts);
 *   - the league the test names (`test.use({ fixtureName })`) already in localStorage, as the app itself saved it;
 *   - a failure if the page tried to reach anything outside the allowlist of known, harmless attempts.
 */
import { test as base, expect, type BrowserContext } from "@playwright/test";

import { guardContext, unexpected, type Blocked } from "./guard.ts";
import { readFixture, type FixtureDoc } from "./fixtures-build.ts";

export const SAVE_KEY = "nfl-sim-ui.league";

const blockedByContext = new WeakMap<BrowserContext, Blocked[]>();

interface Options {
  /** Which prebuilt league to start from (e2e/fixtures/build.ts), or null for an empty browser. */
  fixtureName: string | null;
  /** For the tests that deliberately make forbidden requests to prove they are blocked. */
  allowAnyBlocked: boolean;
}
interface Fixtures {
  origin: string;
  fixture: FixtureDoc | null;
  blocked: Blocked[];
  consoleErrors: string[];
  /** Fails the test if the page tried to reach anything that is not on the list of known attempts. */
  noSurprises: void;
}

export const test = base.extend<Options & Fixtures>({
  fixtureName: [null, { option: true }],
  allowAnyBlocked: [false, { option: true }],

  origin: async ({}, use) => {
    const origin = process.env.E2E_UI_ORIGIN;
    if (!origin || !/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) throw new Error("E2E_UI_ORIGIN is not set to this run's loopback UI server: the global setup did not run");
    await use(origin);
  },

  fixture: async ({ fixtureName }, use) => {
    const dir = process.env.E2E_FIXTURE_DIR;
    if (fixtureName && !dir) throw new Error("E2E_FIXTURE_DIR is not set: the global setup did not build the fixtures");
    await use(fixtureName ? readFixture(dir!, fixtureName) : null);
  },

  // a new context for every test, instead of Playwright's default one, so the guard and the seeded league are part of it
  context: async ({ browser, origin, fixture }, use) => {
    const context = await browser.newContext({
      baseURL: origin,
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "dark",
      // the app's own "motion off" setting (it follows the OS preference): no animation timing to wait on
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 },
      storageState: fixture ? { cookies: [], origins: [{ origin, localStorage: [{ name: SAVE_KEY, value: fixture.save }] }] } : { cookies: [], origins: [] },
    });
    blockedByContext.set(context, await guardContext(context, origin));
    await use(context);
    await context.close();
  },

  blocked: async ({ context }, use) => {
    await use(blockedByContext.get(context) ?? []);
  },

  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      // a blocked request is expected here and is accounted for by `blocked`
      if (m.type() === "error" && !/ERR_BLOCKED_BY_CLIENT/.test(m.text())) errors.push(`console.error: ${m.text()}`);
    });
    await use(errors);
  },

  noSurprises: [
    async ({ blocked, allowAnyBlocked }, use) => {
      await use();
      if (allowAnyBlocked) return;
      expect(unexpected(blocked), "the page tried to reach something outside the allowlist of known attempts").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** A small, fast read of the saved league: only what a test needs, not the megabyte. */
export interface SavedLeague {
  version: number;
  stage: string;
  seed: number | null;
  draftSalt: number | null;
  gmTeam: string | null;
  draft: { mode: string; currentPickIndex: number; pickOrder: string[]; results: Array<{ teamCode: string; selectedId: string | null; name: string | null; team: string | null }> } | null;
  rosterCount: number;
  bytes: number;
}
