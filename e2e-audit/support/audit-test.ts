/**
 * The test object for the visual audit. Per test:
 *   - a brand-new browser context at the requested viewport, colour scheme, motion preference and font mode;
 *   - the league for (team, fixtureName) already in localStorage, as the game itself saved it (e2e/fixtures/build.ts);
 *   - the same default-deny network guard as the functional suite, plus an optional pass-through for the two font hosts;
 *   - a `capture` helper that loads a screen, runs the probes, takes the screenshot and appends a record.
 *
 * Nothing here writes outside the audit output directory, and nothing reaches a server: the engine adapter, the league
 * API and every other origin are aborted by the guard. The app's persistent data is a localStorage string inside a
 * context that is discarded at the end of the test.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";

import { readFixture, type FixtureDoc } from "../../e2e/support/fixtures-build.ts";
import { guardContext, unexpected, type Blocked } from "../../e2e/support/guard.ts";
import { SAVE_KEY } from "../../e2e/support/test.ts";
import { allowRealFonts, FALLBACK_CSS } from "./fonts.ts";
import { CONDITIONS, PRIMARY_TEAM, VIEWPORTS, type Condition, type Viewport } from "./matrix.ts";
import { OUT_DIR } from "./paths.ts";
import { applyVariant, type VariantId } from "./variants.ts";
import { runProbes, type ProbeResult } from "./probes.ts";
import type { Screen } from "./screens.ts";

export { expect, SAVE_KEY };

export { OUT_DIR };

export interface CaptureRecord {
  kind: "capture";
  screen: string;
  group: string;
  state: string;
  team: string;
  viewport: string;
  condition: string;
  variant: string | null;
  fixture: string | null;
  route: string;
  finalUrl: string;
  /** captured: the screen the route names. redirected: the stage machine sent us elsewhere. error: the page failed. */
  status: "captured" | "redirected" | "error";
  screenshot: string | null;
  probe: ProbeResult | null;
  consoleErrors: string[];
  fontsServed: number;
  error?: string;
  at: string;
}

export const dirFor = (team: string): string => {
  const map = JSON.parse(process.env.AUDIT_FIXTURE_DIRS ?? "{}") as Record<string, string>;
  const d = map[team];
  if (!d) throw new Error(`no fixtures were built for team ${team}: the global setup did not run, or the team is out of scope`);
  return d;
};

interface Options {
  team: string;
  fixtureName: string | null;
  viewportId: string;
  conditionId: string;
  /** A presentation-only variant of the fixture (long names, partial reveal), applied to a copy in memory. */
  variant: VariantId | null;
  /** For tests that deliberately make forbidden requests. */
  allowAnyBlocked: boolean;
}
interface Fixtures {
  origin: string;
  fixture: FixtureDoc | null;
  viewport: Viewport;
  condition: Condition;
  blocked: Blocked[];
  consoleErrors: string[];
  fontStats: { served: () => number; failed: () => string[] };
  noSurprises: void;
  /** Loads a screen and records it. */
  capture: (screen: Screen, extra?: { label?: string }) => Promise<CaptureRecord>;
}

export const test = base.extend<Options & Fixtures>({
  team: [PRIMARY_TEAM, { option: true }],
  fixtureName: [null, { option: true }],
  viewportId: ["1280", { option: true }],
  conditionId: ["baseline", { option: true }],
  variant: [null, { option: true }],
  allowAnyBlocked: [false, { option: true }],

  origin: async ({}, use) => {
    const o = process.env.E2E_UI_ORIGIN;
    if (!o || !/^http:\/\/127\.0\.0\.1:\d+$/.test(o)) throw new Error("E2E_UI_ORIGIN is not this run's loopback UI server: the global setup did not run");
    await use(o);
  },
  viewport: async ({ viewportId }, use) => use(VIEWPORTS.find((v) => v.id === viewportId) ?? (() => { throw new Error(`unknown viewport ${viewportId}`); })()),
  condition: async ({ conditionId }, use) => use(CONDITIONS[conditionId] ?? (() => { throw new Error(`unknown condition ${conditionId}`); })()),
  fixture: async ({ fixtureName, team, variant }, use) => {
    const f = fixtureName ? readFixture(dirFor(team), fixtureName) : null;
    // a copy: the file on disk and the parsed document are never modified
    await use(f && variant ? { ...f, save: applyVariant(f.save, variant) } : f);
  },

  fontStats: async ({}, use) => {
    // replaced by the context fixture below; declared so tests can read it
    await use({ served: () => 0, failed: () => [] });
  },

  context: async ({ browser, origin, fixture, viewport, condition }, use, testInfo) => {
    const context = await browser.newContext({
      baseURL: origin,
      serviceWorkers: "block",
      acceptDownloads: false,
      permissions: [],
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: condition.colorScheme,
      reducedMotion: condition.reducedMotion,
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.touch,
      isMobile: viewport.width <= 480,
      deviceScaleFactor: Number(process.env.AUDIT_DSF ?? 1),
      storageState: fixture ? { cookies: [], origins: [{ origin, localStorage: [{ name: SAVE_KEY, value: fixture.save }] }] } : { cookies: [], origins: [] },
    });
    blockedByContext.set(context, await guardContext(context, origin));
    if (condition.fonts === "real") fontsByContext.set(context, await allowRealFonts(context));
    await use(context);
    void testInfo;
    await context.close();
  },

  blocked: async ({ context }, use) => use(blockedByContext.get(context) ?? []),

  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" && !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`);
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

  capture: async ({ page, context, team, viewport, condition, consoleErrors, fixtureName, variant }, use) => {
    await use(async (screen, extra) => {
      const fontStats = fontsByContext.get(context);
      const label = [variant, extra?.label].filter(Boolean).map((x) => `__${x}`).join("");
      const rel = join(team, `${screen.id}${label}__${viewport.id}__${condition.id}.png`);
      const rec: CaptureRecord = {
        kind: "capture", screen: screen.id, group: screen.group, state: screen.state + (extra?.label ? ` [${extra.label}]` : ""), team, viewport: viewport.id, condition: condition.id, variant,
        fixture: fixtureName, route: screen.route, finalUrl: "", status: "error", screenshot: null, probe: null, consoleErrors: [], fontsServed: 0, at: new Date().toISOString(),
      };
      try {
        await page.goto(`/#${screen.route}`);
        await settle(page, condition);
        if (screen.open) await screen.open(page);
        await page.waitForTimeout(250);
        rec.probe = await runProbes(page, { touch: viewport.touch });
        rec.finalUrl = rec.probe.url;
        const wanted = screen.expectPath ?? (screen.route === "/" ? null : new RegExp(`^#?${screen.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`));
        rec.status = wanted && !wanted.test(rec.finalUrl) ? "redirected" : "captured";
        mkdirSync(join(OUT_DIR, "shots", team), { recursive: true });
        await page.screenshot({ path: join(OUT_DIR, "shots", rel), fullPage: true, animations: condition.reducedMotion === "reduce" ? "disabled" : "allow" });
        rec.screenshot = rel;
      } catch (e) {
        rec.status = "error";
        rec.error = String((e as Error).message).slice(0, 400);
      }
      rec.consoleErrors = [...consoleErrors];
      rec.fontsServed = fontStats?.served() ?? 0;
      appendRecord(rec);
      return rec;
    });
  },
});

const blockedByContext = new WeakMap<BrowserContext, Blocked[]>();
const fontsByContext = new WeakMap<BrowserContext, { served: () => number; failed: () => string[] }>();

/** The app has mounted (the boot placeholder is gone), fonts have settled, and any forced fallback face is applied. */
export async function settle(page: Page, condition: Condition): Promise<void> {
  await page.waitForFunction(() => !document.getElementById("boot") && document.getElementById("root")?.children.length, undefined, { timeout: 20_000 });
  if (condition.fallbackFace) await page.addStyleTag({ content: FALLBACK_CSS[condition.fallbackFace] });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

export function appendRecord(rec: object): void {
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(join(OUT_DIR, "records.jsonl"), JSON.stringify(rec) + "\n");
}
