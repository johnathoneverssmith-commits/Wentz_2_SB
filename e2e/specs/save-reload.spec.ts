import { readFileSync } from "node:fs";

import { editSave, readSavedState } from "../support/idb.ts";
import { readSave } from "../support/save.ts";
import { expect, test } from "../support/test.ts";

/**
 * Each genuine-progression save loads into a fresh browser, the app puts me on that stage's own screen, and the
 * league is intact after a reload. The routes are the stage machine's home screens (ui-source/src/state/stageMachine.ts
 * `STAGE_HOME`), written out here because the UI's `@/` imports are not available to this runner.
 */
const CASES = [
  { name: "fantasy-draft", stage: "fantasyDraft", route: "/draft" },
  { name: "coaching-draft", stage: "coachingDraft", route: "/coaching-draft" },
  { name: "preseason", stage: "preseason", route: "/hub" },
] as const;

for (const c of CASES) {
  test.describe(`${c.name} save`, () => {
    test.use({ fixtureName: c.name });

    test(`opens at ${c.route}, and the league is intact after a reload`, async ({ page, fixture, consoleErrors }) => {
      await page.goto("/");
      await expect(page).toHaveURL(new RegExp(`#${c.route}$`));
      await expect(page.locator("#boot")).toHaveCount(0);

      // the browser started from the exact bytes the Node build produced, and holds only this league
      const keys = await page.evaluate(() => Object.keys(window.localStorage).sort());
      // (`nfl-sim-ui.save-status` and `nfl-sim-ui.save-seq` are the app's small notes on when a save last landed
      // and how many changes were made, for telling a player when the last action was not saved)
      expect(keys.filter((k) => !k.startsWith("nfl-sim-ui.league") && !k.startsWith("nfl-sim-ui.save-")), "nothing from another session").toEqual([]);
      // the save was migrated out of localStorage into IndexedDB, which is where it is now read from
      expect(keys, "the old localStorage copy is gone once verified in IndexedDB").not.toContain("nfl-sim-ui.league");
      const first = (await readSave(page))!;
      expect(first.stage).toBe(c.stage);
      expect(first.seed).toBe(fixture!.seed);
      expect(first.gmTeam).toBe(fixture!.viewerTeam);
      expect(first.version).toBe(JSON.parse(fixture!.save).version);

      await page.reload();
      await expect(page).toHaveURL(new RegExp(`#${c.route}$`));
      const second = (await readSave(page))!;
      expect(second.stage).toBe(first.stage);
      expect(second.seed).toBe(first.seed);
      expect(second.gmTeam).toBe(first.gmTeam);
      expect(second.rosterCount).toBe(first.rosterCount);
      expect(consoleErrors).toEqual([]);

      // measured in the real browser: the size the app holds after loading and reloading the league
      test.info().annotations.push({ type: "save-bytes", description: `${c.name}: fixture ${fixture!.sizeBytes}, in browser after load ${first.bytes}, after reload ${second.bytes}` });
      expect(second.bytes).toBeLessThan(4 * 1024 * 1024);
    });
  });
}

/**
 * A save keeps the schedule it was made with. The week solver's tie-break changed (docs/decisions.md), so a league made
 * before that stores a layout the solver no longer produces; loading it, reloading it and opening the schedule screen
 * must leave that layout alone.
 */
test.describe("a save made before the schedule solver changed", () => {
  test.use({ fixtureName: "preseason" });

  test("keeps its stored schedule through load, reload and the schedule screen", async ({ page, consoleErrors }) => {
    const legacy = JSON.parse(readFileSync(new URL("../../test/fixtures/legacy-schedule-2026.json", import.meta.url), "utf8")) as { games: [number, string, string][] };
    const ui = (c: string) => (c === "LA" ? "LAR" : c);
    const stored = legacy.games.map(([week, home, away]) => ({ week, phase: "REG", homeTeam: ui(home), awayTeam: ui(away) }));
    const regOf = (state: any) => state.schedule.filter((g: any) => g.phase === "REG");

    await page.goto("/");
    await expect(page).toHaveURL(/#\/hub$/);
    expect(JSON.stringify(regOf(await readSavedState(page))), "the fixture's own (new) layout differs from the old one").not.toBe(JSON.stringify(stored));

    // make it a save from before the change: same league, the old layout
    await editSave(page, (doc) => {
      doc.state.schedule = [...doc.state.schedule.filter((g: any) => g.phase !== "REG"), ...stored];
    });

    await page.reload();
    await expect(page).toHaveURL(/#\/hub$/);
    expect(regOf(await readSavedState(page)), "after a reload").toEqual(stored);

    await page.goto("/#/schedule");
    await expect(page.getByRole("main")).toBeVisible();
    await page.goto("/#/hub");
    await page.reload();
    expect(regOf(await readSavedState(page)), "after opening the schedule screen and reloading again").toEqual(stored);
    expect(consoleErrors).toEqual([]);
  });
});
