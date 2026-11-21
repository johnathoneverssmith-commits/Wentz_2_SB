/**
 * The browser engine as the default for solo play (issue #74 Phase 5b), with no switch in the address.
 *
 * The e2e contexts choose the local adapter (see support/test.ts); here that choice is removed before the page loads, so
 * the app behaves as it does for a player: a new dynasty is built on the engine in a Web Worker and records which build
 * of it, a saved dynasty played on a different build asks before it plays, and a browser that can't run the engine
 * says what is missing. The engine files are the real ones (`scripts/build-sim-worker.ts`) served on the run's UI origin.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { buildSimWorker, type SimEngineBuild } from "../../scripts/build-sim-worker.ts";
import { editSave, readSavedState } from "../support/idb.ts";
import { assets, newSite, serveEngine } from "../support/sim-engine-site.ts";
import { BROWSER_ENGINE_KEY, expect, test } from "../support/test.ts";

let tmp = "";
let dir = "";
let build: SimEngineBuild;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  tmp = mkdtempSync(join(tmpdir(), "browser-engine-default-"));
  dir = join(tmp, "engine");
  build = await buildSimWorker(dir);
});
test.afterAll(() => tmp && rmSync(tmp, { recursive: true, force: true }));

/** the player's browser: no stored choice of engine */
const asAPlayer = (page: Page) => page.addInitScript((k) => localStorage.removeItem(k), BROWSER_ENGINE_KEY);

const ready = (page: Page) => page.getByRole("button", { name: "Ready for Game Day" });
const playedRegular = (state: any, week: number) => (state.games as any[]).filter((g) => g.phase === "REG" && g.week === week && g.played);

test.describe("a new solo dynasty", () => {
  test("is built on the browser engine by default: the engine is downloaded once, its build is recorded, and League Settings shows it", async ({ page, origin, blocked }) => {
    test.setTimeout(120_000);
    const site = newSite(dir);
    await asAPlayer(page);
    await serveEngine(page, origin, site);
    await page.goto("/#/setup");
    await page.getByRole("tab", { name: "League Settings", exact: true }).click();
    await page.getByRole("textbox", { name: "Seed", exact: true }).fill("2468");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Create league with this universe", exact: true }).click();
    await expect.poll(async () => (await readSavedState<any>(page)).seed, { timeout: 90_000 }).toBe(2468);
    await expect.poll(async () => (await readSavedState<any>(page)).simEngine, { timeout: 90_000 }).toBe("engine");
    const state = await readSavedState<any>(page);
    expect(state.simEngine).toBe("engine");
    expect(state.simEngineVersion).toBe(build.manifest.engineVersion);
    expect(Object.keys(state.players).length).toBeGreaterThan(1000); // the engine's real pool, not the mock's
    // one download of the three files, however many requests the creation made
    expect(assets(site).sort()).toEqual([build.manifest.artifacts.url, build.manifest.pool.url, build.manifest.worker.url].sort());
    expect(blocked.filter((b) => b.reason === "engine-adapter")).toEqual([]);

    const status = page.getByTestId("simulator-status");
    await expect(status).toContainText("Full game engine");
    await expect(status).toContainText(build.manifest.engineVersion.slice(0, 8));
  });
});

test.describe("a saved dynasty on the browser engine", () => {
  test.use({ fixtureName: "season-week-1" });

  async function open(page: Page, origin: string, version: string | undefined) {
    await asAPlayer(page);
    const site = newSite(dir);
    await serveEngine(page, origin, site);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/hub$/);
    await editSave(page, (doc) => {
      doc.state.simEngine = "engine";
      if (version === undefined) delete doc.state.simEngineVersion;
      else doc.state.simEngineVersion = version;
    });
    await page.goto("/?reopened=1#/hub"); // a different address, so the page really reloads and reads the edited save
    await expect(ready(page)).toBeVisible();
    return site;
  }

  test("played on another build: nothing is played until the player confirms, then the move is made and the new build recorded", async ({ page, origin }) => {
    test.setTimeout(120_000);
    await open(page, origin, "f".repeat(64));
    await ready(page).click();
    const notice = page.getByTestId("engine-upgrade");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("The game engine has been updated");
    await expect(notice).toContainText("isn’t available any more");
    await page.waitForTimeout(1500); // longer than the gate's own delay before it moves
    let state = await readSavedState<any>(page);
    expect(playedRegular(state, 1)).toHaveLength(0);
    expect(state.simEngineVersion).toBe("f".repeat(64)); // unchanged until confirmed
    const schedule = JSON.stringify(state.schedule);

    await page.getByTestId("confirm-engine-upgrade").click();
    await expect(notice).toBeHidden();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/#\/hub$/);
    state = await readSavedState<any>(page);
    expect(playedRegular(state, 1)).toHaveLength(16);
    expect(state.simEngineVersion).toBe(build.manifest.engineVersion);
    expect(JSON.stringify(state.schedule)).toBe(schedule); // the stored schedule is never regenerated
  });

  test("played on the same build, or on none recorded: no question; the build is recorded", async ({ page, origin }) => {
    test.setTimeout(120_000);
    await open(page, origin, undefined);
    await ready(page).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/#\/hub$/);
    await expect(page.getByTestId("engine-upgrade")).toHaveCount(0);
    const state = await readSavedState<any>(page);
    expect(playedRegular(state, 1)).toHaveLength(16);
    expect(state.simEngineVersion).toBe(build.manifest.engineVersion);
  });

  test("a Mock dynasty stays on its simulator and never asks for the engine", async ({ page, origin }) => {
    await asAPlayer(page);
    const site = newSite(dir);
    await serveEngine(page, origin, site);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/hub$/);
    await editSave(page, (doc) => {
      doc.state.simEngine = "mock";
      delete doc.state.simEngineVersion;
    });
    await page.goto("/?reopened=1#/hub"); // a different address, so the page really reloads and reads the edited save
    await ready(page).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(site.requests).toEqual([]);
    const state = await readSavedState<any>(page);
    expect(state.simEngine).toBe("mock");
    expect(state.simEngineVersion).toBeUndefined();
  });

  test("in a browser that can't run the engine the app says what is missing and stops; nothing is played", async ({ page, origin }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Worker", { value: undefined, configurable: true });
    });
    await open(page, origin, undefined);
    await ready(page).click();
    const notice = page.getByTestId("engine-unavailable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("can't run the game engine");
    await expect(notice).toContainText("Web Workers");
    await expect(notice).toContainText("Chrome or Edge");
    await expect(notice).not.toContainText("npm run server");
    expect(playedRegular(await readSavedState<any>(page), 1)).toHaveLength(0);
  });
});
