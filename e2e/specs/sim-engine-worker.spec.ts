/**
 * The browser simulation engine in a real Chromium Web Worker (issue #74 Phase 4b).
 *
 * The page under test is a small harness around the real client (`ui-source/src/sim/engineWorker`), served from
 * the run's own UI origin; the engine files come from builds made here (`scripts/build-sim-worker.ts`) and are
 * served by the test's routes so a version can be swapped, a file broken or the connection cut. The Node side is
 * the real local adapter (`server/index.ts`) as a child process: every fixed request is answered by both and the
 * two answers must be identical text. Chromium is V8, like Node: Firefox and Safari are NOT covered by this.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { build } from "esbuild";

import { killTree } from "../../.claude/skills/wentz-verify/run-checks.mjs";
import { buildSimWorker, DEFAULT_POOL, type SimEngineBuild } from "../../scripts/build-sim-worker.ts";
import { allStaffs } from "../../src/engine/staff-data.ts";
import { cleanPlan } from "../../src/engine/gameplan.ts";
import { expect, test } from "../support/test.ts";
import { freePort } from "../support/stack.ts";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const FIXTURE_POOL = join(ROOT, "test/fixtures/pool.json");

interface Result<T> {
  ok: boolean;
  info?: T;
  json?: string;
  error?: { stage?: string; retryable?: boolean; message: string; detail?: string };
}

let tmp = "";
let dirA = "";
let dirB = "";
let buildA: SimEngineBuild;
let buildB: SimEngineBuild;
let harnessJs = "";
let adapter: ChildProcess | null = null;
let adapterPort = 0;

const pool = JSON.parse(readFileSync(DEFAULT_POOL, "utf8")) as { id: string; nfl_team: string; position: string; overall?: number }[];
const playersOf = (t: string) => pool.filter((p) => p.nfl_team === t);
const TEAMS = [...new Set(pool.map((p) => p.nfl_team))].filter((t) => t && t !== "FA").sort();

/** What the test's "server" does right now. */
interface Site {
  dir: string;
  requests: string[];
  breakAsset: string | null;
  failManifest: boolean;
  manifestOverride: ((m: Record<string, unknown>) => Record<string, unknown>) | null;
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  tmp = mkdtempSync(join(tmpdir(), "sim-engine-e2e-"));
  dirA = join(tmp, "a");
  dirB = join(tmp, "b");
  buildA = await buildSimWorker(dirA, FIXTURE_POOL);
  // an engine upgrade: one player rated differently, so a new pool, a new version
  const changed = pool.map((p, i) => (i === 0 ? { ...p, overall: ((p.overall ?? 60) % 90) + 3 } : p));
  const poolB = join(tmp, "pool-b.json");
  (await import("node:fs")).writeFileSync(poolB, JSON.stringify(changed));
  buildB = await buildSimWorker(dirB, poolB);

  const bundled = await build({
    entryPoints: [join(ROOT, "e2e/support/engine-harness-entry.ts")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  harnessJs = bundled.outputFiles[0]!.text;

  adapterPort = await freePort();
  adapter = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: ROOT,
    env: { ...process.env, ADAPTER_PORT: String(adapterPort), NFL_POOL_PATH: FIXTURE_POOL },
    detached: process.platform !== "win32",
    stdio: "ignore",
  });
  for (let i = 0; i < 200; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${adapterPort}/schedule`, { method: "POST", body: "{}", headers: { connection: "close" } });
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the local adapter did not start");
});

test.afterAll(() => {
  if (adapter?.pid) killTree(adapter.pid);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

/** The Node adapter's answer to a request, as the text it put on the wire. */
async function adapterAnswer(route: string, body: unknown): Promise<string> {
  const r = await fetch(`http://127.0.0.1:${adapterPort}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  expect(r.status, `adapter ${route}`).toBe(200);
  return JSON.stringify(await r.json());
}

/** Serves the harness page and the engine files from `site` on the run's UI origin. */
async function serve(page: Page, origin: string, site: Site): Promise<void> {
  await page.route(`${origin}/__engine-harness.html`, (r) =>
    r.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><title>x</title><script src="/__engine-harness.js"></script>' }),
  );
  await page.route(`${origin}/__engine-harness.js`, (r) => r.fulfill({ contentType: "text/javascript", body: harnessJs }));
  await page.route(`${origin}/sim-engine/**`, async (r) => {
    const name = new URL(r.request().url()).pathname.replace("/sim-engine/", "");
    site.requests.push(name);
    if (name === "manifest.json") {
      if (site.failManifest) return r.abort("internetdisconnected");
      const m = JSON.parse(readFileSync(join(site.dir, name), "utf8")) as Record<string, unknown>;
      return r.fulfill({ contentType: "application/json", headers: { "cache-control": "no-cache" }, body: JSON.stringify(site.manifestOverride ? site.manifestOverride(m) : m) });
    }
    if (site.breakAsset && name.startsWith(site.breakAsset)) return r.fulfill({ status: 503, body: "unavailable" });
    try {
      return r.fulfill({ contentType: name.endsWith(".js") ? "text/javascript" : "application/json", headers: { "cache-control": "public, max-age=31536000, immutable" }, body: readFileSync(join(site.dir, name)) });
    } catch {
      return r.fulfill({ status: 404, body: "not found" });
    }
  });
}

const newSite = (dir: string): Site => ({ dir, requests: [], breakAsset: null, failManifest: false, manifestOverride: null });
const assets = (s: Site) => s.requests.filter((n) => n !== "manifest.json");
const ready = (page: Page) => page.evaluate(() => (window as unknown as { __ready: () => Promise<unknown> }).__ready()) as Promise<Result<Record<string, unknown>>>;
const call = (page: Page, route: string, body: unknown) =>
  page.evaluate(([r, b]) => (window as unknown as { __call: (r: string, b: unknown) => Promise<unknown> }).__call(r as string, b), [route, body] as const) as Promise<Result<never>>;

test.describe("the browser simulation engine in Chromium", () => {
  test("loading the real app downloads no engine files", async ({ page, origin }) => {
    const seen: string[] = [];
    page.on("request", (r) => seen.push(r.url()));
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    expect(seen.filter((u) => u.includes("/sim-engine/"))).toEqual([]);
    expect(page.workers()).toHaveLength(0);
    void origin;
  });

  test("a real Web Worker answers every game-engine request exactly as the Node adapter does", async ({ page, origin }) => {
    test.setTimeout(180_000);
    const site = newSite(dirA);
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    expect(site.requests).toEqual([]); // lazy: the page loaded, nothing was fetched

    const r = await ready(page);
    expect(r.ok, JSON.stringify(r.error)).toBe(true);
    expect(r.info).toMatchObject({ engineVersion: buildA.manifest.engineVersion, poolVersion: buildA.manifest.pool.poolVersion, fromCache: false, offline: false });
    // it really is a dedicated worker, started from a blob of the checked script
    expect(page.workers()).toHaveLength(1);
    expect(page.workers()[0]!.url()).toMatch(/^blob:/);

    const teams = TEAMS;
    const games = [
      { homeTeam: teams[0]!, awayTeam: teams[1]! },
      { homeTeam: teams[2]!, awayTeam: teams[3]! },
    ];
    const four = games.flatMap((g) => [g.homeTeam, g.awayTeam]);
    const staffs = allStaffs() as Record<string, unknown>;
    const plan = cleanPlan({ passRate: 8, fourthRedZone: 40, fourthOpp: 10, fourthOwn: -20, blitz: 30, p11: 60, p12: 30, p13: 10 });
    const t14 = teams.slice(0, 14);
    const mk = (seeds: string[]) => ({ seeds, divisionWinners: seeds.slice(0, 4), wildCards: seeds.slice(4), order: seeds });
    const seeding = { AFC: mk(t14.slice(0, 7)), NFC: mk(t14.slice(7)) };
    const sixteen = Array.from({ length: 16 }, (_, i) => ({ homeTeam: teams[(2 * i) % teams.length]!, awayTeam: teams[(2 * i + 1) % teams.length]! }));

    // `/schedule` is deliberately not here: see the known-issue test below
    const requests: [string, unknown][] = [
      ["/simulate-week", { seed: 11, season: 2026, week: 3, phase: "REG", games: sixteen, viewer: sixteen[0] }],
      [
        "/simulate-week",
        {
          seed: 12, season: 2026, week: 5, phase: "REG", games, viewer: games[1], talentScale: 1.5, offenseAdjust: 0.5,
          rosters: Object.fromEntries(four.map((t) => [t, playersOf(t)])),
          depthCharts: { [four[0]!]: { QB: [playersOf(four[0]!).find((p) => p.position === "QB")!.id] } },
          staffs: Object.fromEntries(four.map((t) => [t, staffs[t]])),
          plans: { [four[0]!]: plan, [four[3]!]: plan },
        },
      ],
      ["/simulate-week", { seed: 13, week: 2, phase: "PRE", games: [games[0]] }],
      ["/plan-preview", { seed: 41, phase: "REG", week: 4, homeTeam: four[0], awayTeam: four[1], side: "home", plan }],
      ["/coach-market", { seed: 7 }],
      ["/scheme-fit-baseline", {}],
      ["/playoffs/seed", { games: [{ week: 1, home: four[0], away: four[1], homeScore: 21, awayScore: 17 }, { week: 2, home: four[2], away: four[3], homeScore: 10, awayScore: 20 }] }],
      ["/playoffs/round", { seed: 21, seeding, roundsPlayed: 0, rosters: Object.fromEntries(t14.map((t) => [t, playersOf(t)])), viewerTeam: t14[0] }],
      ["/playoffs/game", { seed: 31, homeTeam: t14[0], awayTeam: t14[7], neutralSite: true, rosters: { [t14[0]!]: playersOf(t14[0]!), [t14[7]!]: playersOf(t14[7]!) }, viewerTeam: t14[0] }],
    ];
    for (const [route, body] of requests) {
      const mine = await call(page, route, body);
      expect(mine.ok, `${route}: ${JSON.stringify(mine.error)}`).toBe(true);
      expect(mine.json, route).toBe(await adapterAnswer(route, body));
    }
    // the pool route returns the pool the worker was started with, which is the one the adapter ran on
    const p = await call(page, "/pool", {});
    expect(JSON.parse(p.json!)).toEqual(JSON.parse(await adapterAnswer("/pool", {})));
  });

  // KNOWN ISSUE, found by this spec: the 2026 schedule differs between Node 22 (V8 12.4) and this Chromium (V8 15).
  // `src/engine/schedule.ts` sorts candidate weeks with a comparator that draws from the seeded RNG
  // (`... || rand() - 0.5`), so what it produces depends on how many comparisons the JavaScript engine's sort makes and
  // in what order, which changes between V8 versions. The same 272 games are played; some land in other weeks.
  // Fixing it changes generated schedules (and season results), so it needs the owner's approval and is its own change.
  // `test.fail` keeps this honest: it passes while the schedules differ and FAILS the day they agree, as a reminder to
  // delete this block and move `/schedule` into the test above.
  test("KNOWN ISSUE: /schedule differs between this Chromium and Node, though the matchups are the same", async ({ page, origin }) => {
    test.fail(true, "the schedule's week assignment depends on the JavaScript engine's sort (schedule.ts rand() comparator)");
    const site = newSite(dirA);
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    expect((await ready(page)).ok).toBe(true);
    const mine = await call(page, "/schedule", { year: 2026 });
    const node = await adapterAnswer("/schedule", { year: 2026 });
    const games = (json: string) => (JSON.parse(json) as { homeTeam: string; awayTeam: string }[]).map((g) => `${g.homeTeam}|${g.awayTeam}`).sort();
    expect(games(mine.json!), "the same games are played").toEqual(games(node)); // true today
    expect(mine.json, "and in the same weeks").toBe(node); // false today: the known issue
  });

  test("the first use downloads once; a reload reads the cache, and with no connection the saved engine still starts", async ({ page, origin }) => {
    const site = newSite(dirA);
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    const first = await ready(page);
    expect(first.ok).toBe(true);
    expect(assets(site).sort()).toEqual([buildA.manifest.artifacts.url, buildA.manifest.pool.url, buildA.manifest.worker.url].sort());
    const progress = await page.evaluate(() => (window as unknown as { __progress: { stage: string; loaded: number; total: number }[] }).__progress);
    const total = buildA.manifest.worker.bytes + buildA.manifest.artifacts.bytes + buildA.manifest.pool.bytes;
    expect(progress.filter((q) => q.stage === "download").at(-1)).toMatchObject({ loaded: total, total });

    site.requests.length = 0;
    await page.reload();
    const warm = await ready(page);
    expect(warm.info).toMatchObject({ fromCache: true, offline: false, engineVersion: buildA.manifest.engineVersion });
    expect(site.requests).toEqual(["manifest.json"]);

    site.requests.length = 0;
    site.failManifest = true;
    await page.reload();
    const offline = await ready(page);
    expect(offline.ok, JSON.stringify(offline.error)).toBe(true);
    expect(offline.info).toMatchObject({ offline: true, fromCache: true });
    expect(assets(site)).toEqual([]);
    expect((await call(page, "/schedule", {})).ok).toBe(true);
  });

  test("a reload across an engine upgrade picks up the new engine and drops the old files", async ({ page, origin }) => {
    const site = newSite(dirA);
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    expect((await ready(page)).info).toMatchObject({ engineVersion: buildA.manifest.engineVersion });

    site.dir = dirB; // the site is deployed with a new engine
    site.requests.length = 0;
    await page.reload();
    const upgraded = await ready(page);
    expect(upgraded.info).toMatchObject({ engineVersion: buildB.manifest.engineVersion, poolVersion: buildB.manifest.pool.poolVersion });
    expect(assets(site)).toEqual([buildB.manifest.pool.url]); // the unchanged worker and artifacts are not downloaded again
    await expect
      .poll(async () => (await page.evaluate(() => (window as unknown as { __cacheKeys: () => Promise<string[]> }).__cacheKeys())).some((u) => u.endsWith(buildA.manifest.pool.url)))
      .toBe(false);
    const keys = await page.evaluate(() => (window as unknown as { __cacheKeys: () => Promise<string[]> }).__cacheKeys());
    expect(keys.some((u) => u.endsWith(buildB.manifest.pool.url))).toBe(true);
    const poolNow = JSON.parse((await call(page, "/pool", {})).json!) as { overall?: number }[];
    expect(poolNow[0]!.overall).toBe(buildB.pool[0]!.overall);
  });

  test("a failed download is reported with advice, and Retry succeeds without re-downloading what arrived", async ({ page, origin }) => {
    const site = newSite(dirA);
    site.breakAsset = "engine-artifacts.";
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    const failed = await ready(page);
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatchObject({ stage: "download", retryable: true });
    expect(failed.error!.message).toMatch(/artifacts/);
    expect(failed.error!.message).toMatch(/Retry/);
    expect(page.workers()).toHaveLength(0);

    site.breakAsset = null;
    site.requests.length = 0;
    const retry = await ready(page);
    expect(retry.ok, JSON.stringify(retry.error)).toBe(true);
    expect(assets(site)).toEqual([buildA.manifest.artifacts.url]);
  });

  test("an engine that won't initialise says what happened and leaves nothing broken in the cache", async ({ page, origin }) => {
    const site = newSite(dirA);
    // a deploy caught half way: the manifest promises a pool version the pool file doesn't have
    site.manifestOverride = (m) => ({ ...m, pool: { ...(m.pool as object), poolVersion: "0".repeat(64) } });
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    const r = await ready(page);
    expect(r.ok).toBe(false);
    expect(r.error).toMatchObject({ stage: "init", retryable: true });
    expect(r.error!.message).toMatch(/wouldn't start/);
    expect(r.error!.message).toMatch(/Retry/);
    expect(r.error!.detail).toMatch(/pool version mismatch/);
    expect(page.workers()).toHaveLength(0); // the worker that refused was shut down
    const keys = await page.evaluate(() => (window as unknown as { __cacheKeys: () => Promise<string[]> }).__cacheKeys());
    expect(keys.filter((u) => !u.endsWith("manifest.json"))).toEqual([]);

    site.manifestOverride = null; // the deploy finishes
    expect((await ready(page)).ok).toBe(true);
  });

  test("timings on a throttled CPU (a stand-in for a mid-range phone, not a measurement of one)", async ({ page, origin }, testInfo) => {
    test.setTimeout(240_000);
    const site = newSite(dirA);
    await serve(page, origin, site);
    await page.goto("/__engine-harness.html");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

    const time = async <T>(f: () => Promise<T>): Promise<[T, number]> => {
      const t0 = Date.now();
      const v = await f();
      return [v, Date.now() - t0];
    };
    const week = { seed: 11, season: 2026, week: 3, phase: "REG", games: Array.from({ length: 16 }, (_, i) => ({ homeTeam: TEAMS[(2 * i) % TEAMS.length]!, awayTeam: TEAMS[(2 * i + 1) % TEAMS.length]! })) };

    const [cold, coldMs] = await time(() => ready(page));
    expect(cold.ok).toBe(true);
    const [w1, weekMs] = await time(() => call(page, "/simulate-week", week));
    expect(w1.ok).toBe(true);
    await page.reload();
    const [warm, warmMs] = await time(() => ready(page));
    expect(warm.info).toMatchObject({ fromCache: true });
    const timings = { cpuThrottle: "4x", coldStartMs: coldMs, warmStartMs: warmMs, sixteenGameWeekMs: weekMs };
    console.log(`sim engine timings: ${JSON.stringify(timings)}`);
    testInfo.annotations.push({ type: "timings", description: JSON.stringify(timings) });
    // generous ceilings: they catch a hang or an order-of-magnitude regression, not a few percent
    expect(coldMs).toBeLessThan(60_000);
    expect(warmMs).toBeLessThan(30_000);
    expect(weekMs).toBeLessThan(60_000);
  });
});
