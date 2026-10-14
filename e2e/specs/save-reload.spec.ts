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
      expect(keys.filter((k) => !k.startsWith("nfl-sim-ui.league")), "nothing from another session").toEqual([]);
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
