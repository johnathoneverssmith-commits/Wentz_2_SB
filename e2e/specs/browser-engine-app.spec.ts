/**
 * The real app, playing on the browser simulation engine (issue #74 Phase 5, opt-in).
 *
 * Nothing here is the default: the browser engine is switched on for the page with `?engine=browser`. The engine
 * files are served from a build made here (`scripts/build-sim-worker.ts`) on the run's UI origin, by the test's
 * routes. The fixture save was built without an engine, so it is edited to the real engine before the page loads
 * (a test-only move: a real dynasty fixes its simulator when it is created).
 *
 * What it proves: a dynasty plays a whole week through a real Web Worker, gets what only the real engine gives
 * (weather on every game, the viewer's play-by-play), never touches the local adapter, downloads the engine once,
 * keeps playing after a reload from the browser's cache, and when the engine cannot be had the app says so, stops,
 * and carries on when Retry succeeds.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { buildSimWorker, type SimEngineBuild } from "../../scripts/build-sim-worker.ts";
import { editSave, readSavedState } from "../support/idb.ts";
import { assets, newSite, serveEngine, type Site } from "../support/sim-engine-site.ts";
import { expect, test } from "../support/test.ts";

test.use({ fixtureName: "season-week-1" });

let tmp = "";
let dir = "";
let build: SimEngineBuild;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tmp = mkdtempSync(join(tmpdir(), "browser-engine-app-"));
  dir = join(tmp, "engine");
  build = await buildSimWorker(dir);
});
test.afterAll(() => tmp && rmSync(tmp, { recursive: true, force: true }));

const ready = (page: Page) => page.getByRole("button", { name: "Ready for Game Day" });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });

/** Loads the fixture, makes the dynasty a real-engine one, and reopens it with the browser engine switched on. */
async function openOnBrowserEngine(page: Page, origin: string, site: Site): Promise<void> {
  await serveEngine(page, origin, site);
  await page.goto("/");
  await expect(page).toHaveURL(/#\/hub$/);
  await editSave(page, (doc) => {
    doc.state.simEngine = "engine";
  });
  await page.goto("/?engine=browser#/hub");
  await expect(ready(page)).toBeVisible();
}

const playedRegular = (state: any, week: number) => (state.games as any[]).filter((g) => g.phase === "REG" && g.week === week && g.played);

test.describe("the real app on the browser engine", () => {
  test("plays a week through a real Web Worker, with what only the real engine gives, and never touches the adapter", async ({ page, origin, blocked }) => {
    test.setTimeout(120_000);
    const site = newSite(dir);
    await openOnBrowserEngine(page, origin, site);
    expect(site.requests).toEqual([]); // the page is open and the dynasty is on the engine, but nothing has asked for it yet
    expect(page.workers()).toHaveLength(0);

    await ready(page).click();
    await expect(page).toHaveURL(/#\/game-day$/);
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);

    // the engine arrived once, for the first game of the first week, and is a real dedicated worker
    expect(site.requests.filter((r) => r === "manifest.json")).toHaveLength(1);
    expect(assets(site).sort()).toEqual([build.manifest.artifacts.url, build.manifest.pool.url, build.manifest.worker.url].sort());
    expect(page.workers()).toHaveLength(1);

    const state = await readSavedState<any>(page);
    expect(state.simEngine).toBe("engine");
    const week1 = playedRegular(state, 1);
    expect(week1.length).toBe(16);
    expect(week1.every((g) => g.weather)).toBe(true); // the Mock never stamps weather
    expect(week1.some((g) => g.broadcast ?? g.playTrace ?? g.scoringPlays?.length)).toBe(true);

    // a second week uses the same worker and fetches nothing more
    const before = site.requests.length;
    await ready(page).click();
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(site.requests.length).toBe(before);
    expect(playedRegular(await readSavedState<any>(page), 2).length).toBe(16);

    // the local adapter was never asked: neither for the dynasty nor for the games
    expect(blocked.filter((b) => b.reason === "engine-adapter")).toEqual([]);
  });

  test("after a reload the engine starts from the browser's cache: only the manifest is asked for", async ({ page, origin, blocked }) => {
    test.setTimeout(120_000);
    const site = newSite(dir);
    await openOnBrowserEngine(page, origin, site);
    await ready(page).click();
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(assets(site)).toHaveLength(3);

    site.requests.length = 0;
    await page.reload();
    await expect(ready(page)).toBeVisible();
    await ready(page).click();
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(site.requests).toEqual(["manifest.json"]);
    expect(playedRegular(await readSavedState<any>(page), 2).length).toBe(16);
    expect(blocked.filter((b) => b.reason === "engine-adapter")).toEqual([]);
  });

  test("when the engine can't be downloaded the app says so and stops; Retry carries on, and no game is half-played", async ({ page, origin }) => {
    test.setTimeout(120_000);
    const site = newSite(dir);
    site.breakAsset = "engine-artifacts.";
    await openOnBrowserEngine(page, origin, site);

    await ready(page).click();
    const notice = page.getByTestId("engine-unavailable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Play is stopped.");
    await expect(notice).toContainText(/couldn.t be downloaded/);
    await expect(notice).toContainText("Retry");
    await expect(notice).not.toContainText("npm run server"); // the adapter's advice would mislead here
    let state = await readSavedState<any>(page);
    expect(playedRegular(state, 1)).toHaveLength(0); // nothing was played or changed
    expect(state.simEngine).toBe("engine"); // and the dynasty did not slip onto the Mock

    // Retry while it is still down: the notice stays, and the gate does not move on or play anything
    await notice.getByRole("button", { name: "Retry" }).click();
    await expect(notice).toBeVisible();
    await page.waitForTimeout(1500); // longer than the gate's own delay before it moves
    expect(playedRegular(await readSavedState<any>(page), 1)).toHaveLength(0);

    site.breakAsset = null; // the connection recovers
    await notice.getByRole("button", { name: "Retry" }).click();
    await expect(notice).toBeHidden();
    // the interrupted move is made again by itself: no second press of Ready
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    state = await readSavedState<any>(page);
    expect(playedRegular(state, 1)).toHaveLength(16);
    expect(state.simEngine).toBe("engine");
  });

  test("without the switch the app is exactly as before: no engine files are fetched and the adapter is tried, not the worker", async ({ page, origin, blocked }) => {
    const site = newSite(dir);
    await serveEngine(page, origin, site);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/hub$/);
    await ready(page).click();
    await cont(page).click();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(site.requests).toEqual([]);
    expect(page.workers()).toHaveLength(0);
    void blocked;
  });
});
