import type { Page } from "@playwright/test";

import { expect, test } from "../support/test.ts";

/**
 * Phone-width usability (backlog cluster 2: PA-001, PA-002, UI-TAFI-004). Real layout in a real browser, because none
 * of these exist in a screenshot of a settled page: the overflow lasts ~100 ms, the contrast depends on the cascade, and
 * the overlap depends on where the browser scrolls a focused control.
 */
const PHONES = [390, 320] as const;

/** WCAG contrast of an element's text against its first opaque background (own or ancestor's), composited on white. */
const contrastOf = (page: Page, el: ReturnType<Page["locator"]>) =>
  el.evaluate((node) => {
    const lum = (c: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    const fg = parse(getComputedStyle(node).color);
    let bg: number[] = [255, 255, 255];
    const layers: number[][] = [];
    for (let n: Element | null = node; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.length >= 3 && (c[3] ?? 1) > 0) layers.push(c);
      if (c.length >= 3 && (c[3] ?? 1) === 1) break;
    }
    for (const c of layers.reverse()) bg = [0, 1, 2].map((i) => c[i]! * (c[3] ?? 1) + bg[i]! * (1 - (c[3] ?? 1)));
    const [a, b] = [lum(fg), lum(bg)];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });

test.describe("PA-001: trade step switcher is readable on a phone", () => {
  test.use({ fixtureName: "trade-deadline" });
  for (const width of PHONES) {
    test(`Your assets / Their assets / Review are at least 4.5:1, selected or not, at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/#/trade-deadline");
      const steps = page.getByRole("group", { name: "Trade workflow" });
      await expect(steps).toBeVisible();
      const buttons = steps.getByRole("button");
      await expect(buttons).toHaveCount(3);
      const seen: string[] = [];
      for (const i of [0, 1, 2]) {
        await buttons.nth(i).click();
        for (const j of [0, 1, 2]) {
          const b = buttons.nth(j);
          const ratio = await contrastOf(page, b);
          seen.push(`${(await b.innerText()).trim()} [${(await b.getAttribute("aria-pressed")) === "true" ? "selected" : "idle"}] ${ratio.toFixed(2)}`);
          expect(ratio, `${await b.innerText()} at ${width}px`).toBeGreaterThanOrEqual(4.5);
        }
      }
      test.info().annotations.push({ type: "contrast", description: seen.join("; ") });
      // still operable: the label names the count, and a click selects it
      await expect(buttons.first()).toHaveText(/Your assets \(\d+\)/);
      await buttons.nth(1).click();
      await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    });
  }
});

test.describe("PA-002: a route change never widens the page on a phone", () => {
  test.use({ fixtureName: "season-week-9" });
  for (const width of PHONES) {
    test(`Game Day at ${width}px, with motion on, stays within the viewport through the entrance`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/#/hub");
      await expect(page.locator(".app-main")).toBeVisible();
      // sample every frame of the entrance after navigating to Game Day
      await page.evaluate(() => {
        const w = window as unknown as { __maxScroll: number };
        w.__maxScroll = 0;
        const t0 = performance.now();
        const tick = () => {
          w.__maxScroll = Math.max(w.__maxScroll, document.documentElement.scrollWidth);
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        location.hash = "#/game-day";
      });
      await page.waitForTimeout(2200);
      const { max, client } = await page.evaluate(() => ({ max: (window as unknown as { __maxScroll: number }).__maxScroll, client: document.documentElement.clientWidth }));
      test.info().annotations.push({ type: "width", description: `max scrollWidth ${max} vs viewport ${client}` });
      expect(max).toBeLessThanOrEqual(client);
      // the page's own controls are still reachable
      await expect(page.locator(".app-main button, .app-main a").first()).toBeVisible();
    });
  }
  test("on a desktop the entrance is unchanged and still within the viewport", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/hub");
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    await page.evaluate(() => (location.hash = "#/game-day"));
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(clientWidth);
  });
});

test.describe("UI-TAFI-004: the floating tabs never hide the control that has keyboard focus", () => {
  test.use({ fixtureName: "trade-deadline" });
  for (const width of PHONES) {
    test(`tabbing the Trade Deadline at ${width}px keeps every focused control clear of the docks`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await page.goto("/#/trade-deadline");
      await expect(page.locator(".how-tab")).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const hidden: string[] = [];
      let focused = 0;
      for (let i = 0; i < 130; i++) {
        await page.keyboard.press("Tab");
        const r = await page.evaluate(() => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || a === document.body || a.matches(".how-tab, .unitgrades-dock")) return null;
          const docks = Array.from(document.querySelectorAll<HTMLElement>(".how-tab, .unitgrades-dock"));
          const b = a.getBoundingClientRect();
          let covered = 0;
          for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5]] as const) {
            const t = document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy);
            if (t && docks.some((d) => d.contains(t))) covered++;
          }
          return { label: `${a.tagName.toLowerCase()}:${(a.textContent || a.getAttribute("aria-label") || "").trim().slice(0, 30)}`, covered };
        });
        if (!r) continue;
        focused++;
        if (r.covered) hidden.push(r.label);
      }
      expect(focused).toBeGreaterThan(60);
      expect(hidden).toEqual([]);
    });
  }
  test("on a desktop nothing changes: no scroll padding is reserved", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/#/trade-deadline");
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom)).toMatch(/^(auto|0px)$/);
  });
});
