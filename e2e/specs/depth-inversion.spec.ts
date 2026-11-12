import type { Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, SAVE_KEY } from "../support/test.ts";
import { readSavedState } from "../support/idb.ts";

interface Saved {
  viewerGmId: string;
  gms: Array<{ id: string; teamCode: string }>;
  players: Record<string, { id: string; name: string; overall: number }>;
  depthChart: Record<string, Record<string, string[]>>;
}
const read = (page: Page): Promise<Saved> => readSavedState(page, SAVE_KEY);
const meOf = (s: Saved) => s.gms.find((g) => g.id === s.viewerGmId)!.teamCode;
const shot = async (page: Page, file: string) => {
  const out = process.env.UI3_ARTIFACTS;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, file) });
};

const warning = (page: Page) => page.getByTestId("depth-inversion-warning");
const names = (page: Page) => page.locator(".roster-list .roster-name");

async function openQuarterbacks(page: Page) {
  await page.goto("/#/roster");
  await page.getByRole("group", { name: "Position group", exact: true }).getByRole("button", { name: "QB", exact: true }).click();
  await expect(page.locator(".roster-list .prow").first()).toBeVisible();
}

for (const [label, size] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }]] as const) {
  test.describe(`depth-chart inversion warning (${label})`, () => {
    test.use({ fixtureName: "season-week-9" });

    test("a normal chart is quiet; a worst-first chart warns, keeps the order, and clears when corrected", async ({ page }) => {
      await page.setViewportSize(size);
      await openQuarterbacks(page);
      await expect(warning(page)).toHaveCount(0);

      // reverse the chart with the real Move buttons: best-first -> worst-first
      const best = page.locator(".roster-list .prow").first();
      const original = await names(page).allTextContents();
      expect(original.length).toBeGreaterThanOrEqual(3);
      await best.click();
      const down = page.getByRole("button", { name: "Move down", exact: true });
      await down.click();
      await expect(names(page).first()).toHaveText(original[1]!);
      await down.click();
      await expect(names(page).nth(2)).toHaveText(original[0]!);
      await names(page).nth(0).click();
      await page.getByRole("button", { name: "Move down", exact: true }).click();
      await expect(names(page)).toHaveText([...original].reverse());

      await expect(warning(page)).toHaveCount(1);
      await expect(warning(page)).toContainText("QB order may be backwards");
      await expect(warning(page)).toContainText("Your order is unchanged");
      await warning(page).scrollIntoViewIfNeeded();
      await shot(page, `inversion-${label}.png`);
      // no horizontal scroll caused by the notice
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // preserved: the warning never touches the saved chart
      const reversed = await read(page);
      const me = meOf(reversed);
      const saved = reversed.depthChart[me]!.QB!;
      expect(saved.map((id) => reversed.players[id]!.name)).toEqual([...original].reverse());
      await page.reload();
      await expect(names(page)).toHaveText([...original].reverse());
      await expect(warning(page)).toHaveCount(1);

      // corrected: it goes away
      await page.getByRole("button", { name: "Auto-reorder by overall", exact: true }).click();
      await expect(names(page)).toHaveText(original);
      await expect(warning(page)).toHaveCount(0);
      await shot(page, `clear-${label}.png`);
    });

    test("a small, plausible swap at the starter line does not warn", async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/#/roster");
      await page.getByRole("group", { name: "Position group", exact: true }).getByRole("button", { name: "WR", exact: true }).click();
      const before = await read(page);
      const ids = await page.locator(".roster-list .prow").evaluateAll((els) => els.map((el) => el.getAttribute("data-player-id")!));
      const gap = before.players[ids[3]!]!.overall - before.players[ids[2]!]!.overall;
      expect(gap, "fixture WR3/WR4 should be a close call").toBeLessThan(10);
      await expect(warning(page)).toHaveCount(0);
      await page.locator(".roster-list .prow").nth(2).click();
      await page.getByRole("button", { name: "Move down", exact: true }).click();
      await expect(names(page).nth(2)).toHaveText(before.players[ids[3]!]!.name);
      await expect(warning(page)).toHaveCount(0);
    });
  });
}
