import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { expect, test, SAVE_KEY } from "../support/test.ts";

/**
 * UI-PT-11/16/17/22/23/24 in a real browser: the shortcuts that exist, and the
 * ones that no longer do. Screenshots (desktop and phone) go to SHOTS when set.
 */
const SHOTS = process.env.SHOTS_DIR ?? "";
const DESKTOP = { width: 1440, height: 1000 };
const PHONE = { width: 390, height: 844 };
const saved = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);

async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
}

for (const [label, size] of [["desktop", DESKTOP], ["mobile", PHONE]] as const) {
  test.describe(`preseason shortcut (${label})`, () => {
    test.use({ fixtureName: "preseason" });
    test(`Simulate Preseason sits beside Ready for Game Day and plays it out`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(page).toHaveURL(/#\/hub$/);
      const ready = page.getByRole("button", { name: "Ready for Game Day", exact: true });
      const sim = page.getByRole("button", { name: "Simulate Preseason", exact: true });
      await expect(ready).toBeVisible();
      await expect(sim).toBeVisible();
      await sim.scrollIntoViewIfNeeded();
      await shot(page, `preseason-controls-${label}`);
      const before = await saved(page);
      expect(before.stage).toBe("preseason");
      await sim.click();
      await expect(page).toHaveURL(/#\/results\/PRE\/\d+\/\d+/);
      const after = await saved(page);
      expect(after.stage).not.toBe("preseason");
      const scheduled = after.schedule.filter((g: { phase: string }) => g.phase === "PRE").length;
      expect(after.games.filter((g: { phase: string; played: boolean }) => g.phase === "PRE" && g.played)).toHaveLength(scheduled);
      await shot(page, `preseason-results-${label}`);
    });
  });
}

for (const [label, size] of [["desktop", DESKTOP], ["mobile", PHONE]] as const) {
  test.describe(`regular-season shortcut (${label})`, () => {
    test.use({ fixtureName: "season-week-1" });
    test(`Simulate Regular Season stops at the trade-deadline checkpoint`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(page).toHaveURL(/#\/hub$/);
      await expect(page.getByRole("button", { name: "Ready for Game Day", exact: true })).toBeVisible();
      const sim = page.getByRole("button", { name: "Simulate Regular Season", exact: true });
      await expect(sim).toBeVisible();
      await sim.scrollIntoViewIfNeeded();
      await shot(page, `regular-season-controls-${label}`);
      await sim.click();
      await expect(page).toHaveURL(/#\/results\/REG\/1\/9/);
      const after = await saved(page);
      expect(after.stage).toBe("tradeDeadline");
      expect(Math.max(...after.games.filter((g: { phase: string; played: boolean }) => g.phase === "REG" && g.played).map((g: { week: number }) => g.week))).toBe(9);
      await shot(page, `regular-season-checkpoint-${label}`);
    });
  });
}

test.describe("closed shortcuts", () => {
  test.use({ fixtureName: "season-week-9" });
  test("the command center has no trade-proposal shortcut; trades and signings are read-only", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/hub$/);
    const dashboard = page.getByRole("region", { name: "Franchise dashboard" });
    await expect(dashboard.getByRole("link", { name: /Roster/ })).toBeVisible();
    await expect(dashboard.getByRole("link", { name: /Trade proposals/ })).toHaveCount(0);
    await page.goto("/#/trade");
    await expect(page.getByRole("button", { name: "Proposals closed" })).toBeDisabled();
    await expect(page.getByText(/only be proposed during the Trade Deadline window/i)).toBeVisible();
    await shot(page, "trade-closed-desktop");
    await page.goto("/#/free-agency");
    await expect(page.getByText(/Browsing only/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Negotiate" })).toHaveCount(0);
    await shot(page, "free-agency-browse-desktop");
  });
});

for (const [label, size] of [["desktop", DESKTOP], ["mobile", PHONE]] as const) {
  test.describe(`coaching delegation (${label})`, () => {
    test.use({ fixtureName: "coaching-draft" });
    test("delegating the rest hands the remaining jobs to staff after a manual pick", async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/");
      await expect(page).toHaveURL(/#\/coaching-draft$/);
      const delegate = page.getByRole("button", { name: "Delegate Remaining Picks to Staff" });
      await expect(delegate).toBeVisible();
      // one manual pick first
      await page.getByRole("button", { name: /^Hire / }).first().click();
      await delegate.scrollIntoViewIfNeeded();
      await shot(page, `coaching-delegate-${label}`);
      await delegate.click();
      await shot(page, `coaching-delegate-confirm-${label}`);
      await page.getByRole("button", { name: "Yes, delegate" }).click();
      await expect.poll(async () => (await saved(page)).stage).not.toBe("coachingDraft");
      // a reload keeps it
      await page.reload();
      const after = await saved(page);
      const me = after.gms.find((g: { id: string }) => g.id === after.viewerGmId).teamCode;
      const mine = after.coachingDraft.results.filter((r: { teamCode: string }) => r.teamCode === me);
      expect(mine).toHaveLength(12);
      expect(mine[0].byStaff).toBeUndefined();
      expect(mine.slice(1).every((r: { byStaff?: boolean }) => r.byStaff)).toBe(true);
      expect(after.coachingDraft.delegated).toContain(me);
    });
  });
}
