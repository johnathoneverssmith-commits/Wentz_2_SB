import type { Page } from "@playwright/test";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { guardContext, unexpected } from "../support/guard.ts";
import { expect, test, SAVE_KEY } from "../support/test.ts";

interface Saved {
  viewerGmId: string;
  gms: Array<{ id: string; teamCode: string }>;
  teams: Record<string, { cap: { used: number; total: number; dead: number } }>;
  players: Record<string, { id: string; name: string; position: string; contract: { years_remaining: number; total_value: number; guaranteed: number; signing_bonus: number; cap_hit_by_year: number[] } }>;
  depthChart: Record<string, Record<string, string[]>>;
}
const read = (page: Page): Promise<Saved> => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
const meOf = (s: Saved) => s.gms.find(g => g.id === s.viewerGmId)!.teamCode;
const money = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(1)}M`;
const capture = async (page: Page, file: string, fullPage = false) => {
  const out = process.env.UI3_ARTIFACTS;
  if (!out) return;
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, file), fullPage });
};

test.describe("roster and finance presentation", () => {
  test.use({ fixtureName: "season-week-9" });

  test("the dashboard finance link opens the cap view with the saved amounts", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto("/");
    const before = await read(page);
    const cap = before.teams[meOf(before)]!.cap;
    await page.locator(".cap-snapshot").getByRole("link", { name: /Details/ }).click();
    await expect(page).toHaveURL(/#\/roster\?tab=cap$/);
    await expect(page.getByRole("tab", { name: "Cap table", exact: true })).toHaveAttribute("aria-selected", "true");
    const overview = page.getByRole("region", { name: "Player cap overview" });
    await expect(overview.getByRole("meter")).toHaveAttribute("aria-valuetext", `${cap.used} of ${cap.total}`);
    for (const amount of [cap.used, cap.total, cap.dead, Math.round((cap.total - cap.used) * 10) / 10]) await expect(overview).toContainText(money(amount));
    await expect(page.getByText("Outside the player cap", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Finances & Cap", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Roster & Cap", exact: true })).not.toHaveAttribute("aria-current", "page");
    await capture(page, "desktop-cap.png");
    const contracts = page.locator(".contract-player-list button");
    const secondId = await contracts.nth(1).getAttribute("data-player-id");
    const second = before.players[secondId!]!;
    await contracts.nth(1).click();
    const dossier = page.getByRole("complementary", { name: "Selected player" });
    await expect(dossier).toHaveAttribute("data-player-id", second.id);
    await expect(dossier.getByRole("heading", { name: second.name, exact: true })).toBeVisible();
    await expect(dossier.getByRole("region", { name: "Scheduled cap hits" })).toContainText(money(second.contract.cap_hit_by_year[0]!));
    await page.reload();
    await expect(page.getByRole("tab", { name: "Cap table", exact: true })).toHaveAttribute("aria-selected", "true");
    expect((await read(page)).teams).toEqual(before.teams);
    await page.goBack();
    await expect(page).toHaveURL(/#\/hub$/);
    await page.goForward();
    await expect(page.getByRole("tab", { name: "Cap table", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("a real depth-chart move persists after reload and preserves contract facts", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto("/#/roster");
    await page.getByRole("group", { name: "Position group", exact: true }).getByRole("button", { name: "QB", exact: true }).click();
    const rows = page.locator(".roster-list .prow");
    const idsBefore = await rows.evaluateAll(els => els.map(el => el.getAttribute("data-player-id")!));
    expect(idsBefore.length).toBeGreaterThan(1);
    const before = await read(page);
    const first = before.players[idsBefore[0]!]!;
    const names = idsBefore.map(id => before.players[id]!.name);
    await expect(page.locator(".roster-list .roster-name")).toHaveText(names);
    expect(first.position).toBe("QB");
    const row = page.locator(".roster-list .prow").filter({ has: page.locator(".roster-name", { hasText: first.name }) });
    await row.focus(); await page.keyboard.press("Enter");
    await expect(row).toHaveAttribute("aria-pressed", "true");
    const facts = page.getByRole("region", { name: "Contract details" });
    await expect(facts).toContainText(money(first.contract.total_value));
    await expect(facts).toContainText(money(first.contract.guaranteed));
    await expect(facts).toContainText(money(first.contract.cap_hit_by_year[0]!));
    await capture(page, "desktop-roster.png");
    await page.getByRole("button", { name: "Move down", exact: true }).click();
    const expected = [names[1]!, names[0]!, ...names.slice(2)];
    await expect(page.locator(".roster-list .roster-name")).toHaveText(expected);
    const ids = [idsBefore[1]!, idsBefore[0]!, ...idsBefore.slice(2)];
    expect(await rows.evaluateAll(els => els.map(el => el.getAttribute("data-player-id")))).toEqual(ids);
    await expect.poll(async () => (await read(page)).depthChart[meOf(before)]!.QB).toEqual(ids);
    await page.reload();
    await expect(page.locator(".roster-list .roster-name")).toHaveText(expected);
    expect((await read(page)).players[first.id]!.contract).toEqual(first.contract);
  });

  test("player and extension dialogs support keyboard focus, Escape and cancellation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/#/roster");
    for (const stat of await page.locator(".sports-stat").all()) {
      const card = (await stat.boundingBox())!;
      const value = (await stat.locator("strong").boundingBox())!;
      expect(value.x + value.width).toBeLessThanOrEqual(card.x + card.width);
    }
    await page.locator(".roster-list .prow").first().click();
    const before = await read(page);
    await page.getByRole("button", { name: "Player card", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Player card", exact: true })).toBeFocused();
    const extend = page.getByRole("button", { name: "Extend contract", exact: true });
    await extend.click();
    dialog = page.getByRole("dialog");
    const base = dialog.getByRole("spinbutton", { name: "Base salary / yr", exact: true });
    // Exercise an editable offer inside the existing control's bounds, then cancel.
    // Keep the edit independent of changes to the fixture star's opening expectation.
    await base.fill("10");
    await base.press("Tab");
    await dialog.getByRole("button", { name: "More base salary / yr", exact: true }).click();
    await expect(base).toHaveValue("10.5");
    await dialog.getByRole("button", { name: "Submit offer", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(extend).toBeFocused();
    expect((await read(page)).players).toEqual(before.players);
  });

  test("mobile cards retain every field and the financial and dialog controls fit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/roster");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const row = page.locator(".roster-list .prow").first();
    for (const label of ["Overall", "Age", "Deal", "Cap hit"]) await expect(row.getByText(label, { exact: true })).toBeVisible();
    await capture(page, "mobile-roster.png", true);
    await row.click();
    await page.getByRole("button", { name: "Extend contract", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Submit offer", exact: true })).toBeInViewport();
    const rect = await dialog.getByRole("button", { name: "More base salary / yr", exact: true }).boundingBox();
    expect(rect!.height).toBeGreaterThanOrEqual(44);
    expect(rect!.width).toBeGreaterThanOrEqual(44);
    await capture(page, "mobile-contract.png");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Cap table", exact: true }).click();
    await expect(page.getByRole("region", { name: "Player cap overview" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test("unit meters respect reduced motion and a guarded motion demo uses real controls", async ({ page, browser, origin, fixture }) => {
    await page.goto("/#/roster?tab=units");
    await expect(page.getByRole("meter").first()).toBeVisible();
    expect(await page.getByRole("meter").first().locator("span").evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
    const out = process.env.UI3_ARTIFACTS;
    if (!out || process.env.UI3_VIDEO !== "1") return;
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference", serviceWorkers: "block", recordVideo: { dir: out, size: { width: 1280, height: 900 } }, storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: SAVE_KEY, value: fixture!.save }] }] } });
    const blocked = await guardContext(context, origin);
    let video;
    try {
      const demo = await context.newPage(); video = demo.video()!;
      await demo.goto("/#/roster");
      await demo.locator(".roster-list .prow").first().click();
      await demo.getByRole("button", { name: "Extend contract", exact: true }).click();
      await demo.waitForTimeout(400); // review recording only
      await demo.keyboard.press("Escape");
      await demo.getByRole("tab", { name: "Cap table", exact: true }).click();
      await demo.waitForTimeout(700);
      await demo.getByRole("tab", { name: "Unit grades", exact: true }).click();
      await demo.waitForTimeout(500);
      expect(unexpected(blocked)).toEqual([]);
    } finally { await context.close(); }
    if (!video) throw new Error("Review video did not start");
    const original = await video.path(); const target = join(out, "roster-motion.webm");
    await video.saveAs(target); if (original !== target) unlinkSync(original);
  });
});
