import type { Video } from "@playwright/test";
import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { guardContext, unexpected } from "../support/guard.ts";
import { expect, test, SAVE_KEY } from "../support/test.ts";

test.describe("franchise dashboard presentation", () => {
  test.use({ fixtureName: "season-week-9" });

  test("shows bound schedule, cap and unit data without exposing unseen results", async ({ page, browser, origin, fixture }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await expect(page).toHaveURL(new RegExp("#/hub$"));
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).state, SAVE_KEY);
    const me = saved.gms.find((g: { id: string }) => g.id === saved.viewerGmId).teamCode;
    const dashboard = page.getByRole("region", { name: "Franchise dashboard" });
    await expect(dashboard.getByRole("heading", { name: "Season timeline" })).toBeVisible();
    const games = saved.schedule.filter((g: { phase: string; homeTeam: string; awayTeam: string }) => g.phase === "REG" && (g.homeTeam === me || g.awayTeam === me));
    await expect(dashboard.locator(".season-game")).toHaveCount(Math.max(...games.map((g: { week: number }) => g.week)));
    await expect(dashboard.locator(".season-game").filter({ hasText: "Bye" })).toHaveCount(Math.max(...games.map((g: { week: number }) => g.week)) - games.length);
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      const result = saved.games.find((r: { phase: string; week: number; played: boolean; homeTeam: string; awayTeam: string }) => r.phase === g.phase && r.week === g.week && r.played && r.homeTeam === g.homeTeam && r.awayTeam === g.awayTeam);
      const tile = dashboard.locator('[data-week="' + g.week + '"]');
      await expect(tile).toHaveAttribute("data-team", g.homeTeam === me ? g.awayTeam : g.homeTeam);
      if (result) {
        const ours = g.homeTeam === me ? result.homeScore : result.awayScore;
        const theirs = g.homeTeam === me ? result.awayScore : result.homeScore;
        await expect(tile.locator(".season-game__score")).toHaveText(ours + "–" + theirs);
      } else await expect(tile).toContainText("Upcoming");
    }
    await expect(dashboard.getByRole("meter", { name: "Salary cap used" })).toHaveAttribute("aria-valuetext", saved.teams[me].cap.used + " of " + saved.teams[me].cap.total);
    await expect(page.getByRole("button", { name: "Ready for Game Day", exact: true })).toBeVisible();
    const out = process.env.UI_REVIEW_ARTIFACTS;
    if (out) {
      mkdirSync(out, { recursive: true });
      // Capture after entrance motion, rather than a half-revealed review image.
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(out, "desktop.png"), fullPage: false });
      if (process.env.UI_REVIEW_VIDEO === "1") {
        const context = await browser.newContext({
          viewport: { width: 1280, height: 900 }, reducedMotion: "no-preference", serviceWorkers: "block",
          recordVideo: { dir: out, size: { width: 1280, height: 900 } },
          storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: SAVE_KEY, value: fixture!.save }] }] },
        });
        const blocked = await guardContext(context, origin);
        let video: Video | null = null;
        try {
          const demo = await context.newPage();
          video = demo.video()!;
          await demo.goto(origin);
          await expect(demo.getByRole("heading", { name: "Season timeline" })).toBeVisible();
          await demo.getByRole("region", { name: "Franchise dashboard" }).getByRole("link", { name: /Trade proposals/ }).hover();
          await demo.waitForTimeout(350);
          await demo.getByRole("tab", { name: "Overview", exact: true }).click();
          await demo.waitForTimeout(450);
          await demo.getByRole("tab", { name: "Matchup", exact: true }).click();
          await demo.waitForTimeout(450);
          expect(unexpected(blocked)).toEqual([]);
        } finally { await context.close(); }
        if (!video) throw new Error("The demo page did not start recording");
        const original = await video.path();
        const target = join(out, "dashboard-motion.webm");
        await video.saveAs(target);
        if (original !== target) unlinkSync(original);
      }
    }
  });

  test("mobile layout contains its horizontal timeline and preserves the game action", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Season timeline" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const timeline = page.getByRole("list", { name: "Your season schedule" });
    await expect(page.getByRole("button", { name: "Ready for Game Day", exact: true })).toBeInViewport();
    await timeline.focus();
    await page.keyboard.press("ArrowRight");
    await expect(timeline).toBeFocused();
    await expect(page.getByRole("button", { name: "Ready for Game Day", exact: true })).toBeVisible();
    const out = process.env.UI_REVIEW_ARTIFACTS;
    if (out) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: join(out, "mobile.png"), fullPage: false });
      await page.screenshot({ path: join(out, "mobile-full.png"), fullPage: true });
    }
  });

  test("keyboard users can skip the rail, change tabs, and follow a real front-office link", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    const overview = page.getByRole("tab", { name: "Overview", exact: true });
    await overview.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Injuries", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Injuries", exact: true })).toBeFocused();
    await page.getByRole("region", { name: "Franchise dashboard" }).getByRole("link", { name: /Roster & cap/ }).click();
    await expect(page).toHaveURL(new RegExp("#/roster$"));
  });

  test("device reduced motion takes precedence over a saved full preference and can change live", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("fs.motion", "full"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
    await expect(page.getByRole("region", { name: "Franchise dashboard" })).toBeVisible();
    expect(await page.locator(".decision-link").first().evaluate(el => getComputedStyle(el).transitionDuration)).toBe("0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  });
});

