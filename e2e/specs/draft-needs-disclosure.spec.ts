import type { Page } from "@playwright/test";

import { test, expect } from "../support/test";

/**
 * The Draft Room's "Roster needs & unit grades" disclosure read #c9dcf0 on the light page (1.25:1, QA register PA-003).
 * Measured here against the colour actually painted behind it, at the three audited widths, plus keyboard focus and
 * keyboard expand/collapse.
 */
test.use({ fixtureName: "fantasy-draft" });

async function measure(page: Page) {
  return page.evaluate(() => {
    const summary = Array.from(document.querySelectorAll("summary")).find((s) => s.textContent?.includes("Roster needs"))!;
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    // composite every translucent layer from the first opaque ancestor down to the summary, then the text over that
    const over = (top: number[], a: number, under: number[]) => top.map((v, i) => v * a + under[i]! * (1 - a));
    const layers: number[][] = [];
    let image = false;
    for (let el: Element | null = summary; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.backgroundImage !== "none") image = true;
      const [r, g, b, a = 1] = parse(cs.backgroundColor);
      if (a > 0) layers.push([r!, g!, b!, a]);
      if (a === 1) break;
    }
    let bg = [255, 255, 255]; // the page canvas, if no ancestor was opaque
    for (const [r, g, b, a] of layers.reverse()) bg = over([r!, g!, b!], a!, bg);
    const [fr, fg0, fb, fa = 1] = parse(getComputedStyle(summary).color);
    const fg = over([fr!, fg0!, fb!], fa, bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    return { image, fg: fg.map(Math.round).join(","), bg: bg.map(Math.round).join(","), ratio: Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100 };
  });
}

for (const width of [320, 390, 1440]) {
  test(`disclosure text is at least 4.5:1 at ${width}px, shows focus, and opens from the keyboard`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("dialog").filter({ hasText: "on the clock" }).click();
    const summary = page.locator("summary", { hasText: "Roster needs & unit grades" });
    await summary.scrollIntoViewIfNeeded();
    const m = await measure(page);
    console.log(`CONTRAST ${width}px ${JSON.stringify(m)}`);
    info.annotations.push({ type: "contrast", description: JSON.stringify(m) });
    expect(m.image, "a background image behind the text would make the computed colour unreliable").toBe(false);
    await summary.screenshot({ path: `${process.env.SHOT_DIR ?? "test-results"}/summary-${width}.png` });
    expect(m.ratio).toBeGreaterThanOrEqual(4.5);

    // a key press first, so the browser is in keyboard modality and :focus-visible applies to the programmatic focus
    await page.keyboard.press("Tab");
    await summary.focus();
    await expect(summary).toBeFocused();
    const ring = await summary.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: s.outlineWidth, shadow: s.boxShadow }; });
    console.log(`FOCUS ${width}px ${JSON.stringify(ring)}`);
    expect(ring.style !== "none" && parseFloat(ring.width) > 0 || ring.shadow !== "none").toBe(true);

    const details = summary.locator("xpath=..");
    await expect(details).not.toHaveAttribute("open", "");
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await page.keyboard.press("Space");
    await expect(details).not.toHaveAttribute("open", "");
  });
}
