import type { Page } from "@playwright/test";

import { readSaveText } from "../support/idb.ts";
import { readSave } from "../support/save.ts";
import { expect, SAVE_KEY, test } from "../support/test.ts";

/**
 * GAP-008 in a real browser, against the real IndexedDB the app uses (nothing is stubbed except, where a test says so,
 * the one call that makes a write fail).
 *
 * The drafted pick is the "change" in each test: a real action on a seeded fantasy-draft league.
 */
test.use({ fixtureName: "fantasy-draft" });

async function open(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page).toHaveURL(/#\/draft$/);
  const overlay = page.getByRole("dialog").filter({ hasText: "on the clock" });
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toBeHidden();
}

async function draftThirdOnBoard(page: Page): Promise<void> {
  const target = page.getByRole("table").getByRole("button", { name: /^Draft / }).nth(2);
  await expect(target).toBeEnabled();
  await target.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm pick", exact: true }).click();
}

const picks = async (page: Page): Promise<number> => (await readSave(page))!.draft!.results.length;

test.describe("durable save", () => {
  test("the seeded localStorage save is migrated into IndexedDB, and saves are written there from then on", async ({ page }) => {
    await open(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY), "the old localStorage copy is removed once verified").toBeNull();
    const first = await readSaveText(page);
    expect(first, "the league is in IndexedDB").not.toBeNull();
    const before = await picks(page);
    await draftThirdOnBoard(page);
    await expect.poll(() => picks(page)).toBeGreaterThan(before);
    expect(await page.evaluate((k) => localStorage.getItem(k), SAVE_KEY), "still nothing under the localStorage key").toBeNull();
  });

  test("a write that fails raises the banner with backup access, the last good save stays, and a reload says what was lost", async ({ page }) => {
    await open(page);
    const before = await picks(page);
    // the one thing stubbed: the browser refusing an IndexedDB write
    await page.evaluate(() => {
      IDBObjectStore.prototype.put = function () {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    await draftThirdOnBoard(page);
    const alert = page.getByRole("alert").filter({ hasText: "being saved" });
    await expect(alert).toBeVisible();
    await expect(alert.getByRole("button", { name: "Download backup" })).toBeVisible();
    await expect(alert.getByRole("button", { name: "Restore from backup" })).toBeVisible();

    // a reload loses the unsaved pick — and says so, rather than showing the older save as if nothing happened
    await page.reload();
    await expect(page.getByText("Some progress from your last session")).toBeVisible();
    expect(await picks(page), "the last good save is what loaded").toBe(before);
  });

  test("a change followed at once by a reload is never silently rolled back", async ({ page }) => {
    await open(page);
    const before = await picks(page);
    await draftThirdOnBoard(page);
    // not `page.reload()` (which lets the app finish writing first): the reload the browser does mid-write
    await page.evaluate(() => location.reload());
    await expect(page).toHaveURL(/#\/draft$/);
    await expect(page.locator("#boot")).toHaveCount(0);
    const notice = page.getByText("Your last action wasn");
    await expect
      .poll(async () => ((await picks(page)) > before ? "kept" : (await notice.isVisible()) ? "told" : "silent"), {
        message: "either the pick is there, or the player is told it was not saved — never neither",
      })
      .not.toBe("silent");
  });
});
