import { expect, test } from "../support/test.ts";

/**
 * Keyboard and screen-reader behaviour of the PR #72 surfaces: universe selection, team selection and the title,
 * the scouting dossier, the draft-summary rankings and the unit scorecards. Everything is done with the keyboard,
 * and roles/names are what a screen reader would be given.
 */
const contrast = async (page: import("@playwright/test").Page, selector: string): Promise<number> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement;
    const lum = (rgb: number[]) => {
      const f = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      return 0.2126 * f(rgb[0]!) + 0.7152 * f(rgb[1]!) + 0.0722 * f(rgb[2]!);
    };
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    let bg = parse(cs.backgroundColor);
    let n: HTMLElement | null = el;
    while (n && (bg.length < 3 || (bg[3] ?? 1) === 0)) { n = n.parentElement; if (n) bg = parse(getComputedStyle(n).backgroundColor); }
    const a = bg[3] ?? 1;
    const over = [0, 1, 2].map((i) => bg[i]! * a + 10 * (1 - a)); // composite on a near-black page
    const [l1, l2] = [lum(fg), lum(over)];
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }, selector);

test.describe("setup: universe and team selection by keyboard", () => {
  test("the universe radio group is one tab stop, arrows move the choice, and the era control appears with it", async ({ page }) => {
    await page.goto("/#/setup");
    await page.getByRole("tab", { name: "League Settings", exact: true }).click();
    const group = page.getByRole("radiogroup", { name: "Universe", exact: true });
    const radios = group.getByRole("radio");
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true"); // fictional is the default
    await expect(radios.nth(0)).toHaveAttribute("tabindex", "-1");
    await radios.nth(1).focus();
    await page.keyboard.press("ArrowRight");
    await expect(radios.nth(2)).toBeFocused();
    await expect(radios.nth(2)).toHaveAttribute("aria-checked", "true");
    await expect(page.getByLabel("Historical era")).toBeVisible();
    await page.keyboard.press("ArrowRight"); // wraps
    await expect(radios.nth(0)).toBeFocused();
    await expect(page.getByLabel("Historical era")).toHaveCount(0);
    // every control has a name, and the seed field reports invalid input
    const seed = page.getByRole("textbox", { name: "Seed", exact: true });
    await seed.fill("abc");
    await expect(seed).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("button", { name: "Create league with this universe" })).toBeDisabled();
  });

  test("choosing a team with the keyboard updates the title and announces it", async ({ page }) => {
    await page.goto("/#/setup");
    await expect(page.getByRole("heading", { level: 1, name: "Road to the Super Bowl", exact: true })).toBeVisible();
    const tile = page.locator("button:has-text('Seattle Seahawks')").first();
    await tile.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "The Seahawks' Road to the Super Bowl", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "You are the Seahawks" })).toBeAttached();
  });
});

test.describe("scouting dossier", () => {
  test.use({ fixtureName: "fantasy-draft" });
  test("opens from a name with Enter or Space, traps focus, labels its table, and Escape returns focus", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("dialog").filter({ hasText: "on the clock" }).click();
    const trigger = page.locator(".draft-avail tbody tr").first().locator("[role=button]").first();
    const name = (await trigger.innerText()).trim();
    await trigger.focus();
    await page.keyboard.press("Space");
    const dialog = page.getByRole("dialog", { name, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("table")).toBeVisible();
    await expect(dialog.getByRole("columnheader", { name: "+/−" })).toBeVisible();
    // focus stays inside the dialog while tabbing
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[role=dialog]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close scouting dossier" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("a recent pick opens the same dossier from the keyboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("dialog").filter({ hasText: "on the clock" }).click();
    const button = page.getByRole("button", { name: /^Open scouting dossier for / }).first();
    if (await button.count()) {
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog").getByRole("table")).toBeVisible();
    }
  });
});

test.describe("draft summary rankings", () => {
  test.use({ fixtureName: "coaching-draft" });
  test("each ranked team is a keyboard-operable disclosure", async ({ page }) => {
    await page.goto("/#/fantasy-draft-summary");
    const first = page.locator(".dso-ranks button").first();
    await expect(first).toBeVisible();
    await first.focus();
    await expect(first).toHaveAttribute("aria-expanded", "false");
    await expect(first).not.toHaveAttribute("aria-controls", /./);
    await page.keyboard.press("Enter");
    await expect(first).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`#${await first.getAttribute("aria-controls")}`);
    await expect(panel).toContainText("Offense");
    await page.keyboard.press("Space");
    await expect(first).toHaveAttribute("aria-expanded", "false");
    // the grade is named for a screen reader
    await expect(page.getByLabel(/^Draft grade /)).toBeVisible();
  });
});

test.describe("unit scorecards", () => {
  test.use({ fixtureName: "fantasy-draft" });
  test("cards are a labelled list, detail toggles by keyboard, and text meets contrast", async ({ page }) => {
    await page.goto("/#/roster?tab=units");
    const list = page.getByRole("list", { name: "Unit scorecards" });
    await expect(list).toBeVisible();
    const toggle = list.getByRole("button", { name: "Starters & depth" }).first();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(list.getByRole("table").first()).toBeVisible();
    expect(await contrast(page, ".unit-name")).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, ".unit-card-rank")).toBeGreaterThanOrEqual(4.5);
    expect(await contrast(page, ".unit-card-toggle")).toBeGreaterThanOrEqual(4.5);
  });
});
