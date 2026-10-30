import type { Page } from "@playwright/test";

import { readSave } from "../support/save.ts";
import { expect, test } from "../support/test.ts";
import { readSummary } from "../support/fixtures-build.ts";

/**
 * The broadcast-style "On the clock" interstitial covers the board and asks to be tapped, as it does for a
 * player. Dismissed the way a player does: by clicking it.
 */
async function dismissOnTheClock(page: Page): Promise<void> {
  const overlay = page.getByRole("dialog").filter({ hasText: "on the clock" });
  await expect(overlay).toBeVisible();
  await overlay.click();
  await expect(overlay).toBeHidden();
}

/**
 * A real player action in the real app: the human GM drafts a player in the fantasy draft, and the league that
 * results is checked in the browser's own saved state, before and after a reload.
 *
 * The league is the fixture built by playing the game's stage machine from setup to the fantasy draft (no stage
 * is set by hand). The draft screen starts the draft itself on arrival, as it does for a player; the order it
 * derives is compared with the one the Node build derived from the same seed and salt.
 */
test.describe("fantasy draft", () => {
  test.use({ fixtureName: "fantasy-draft" });

  test("drafting a player puts that player on my team, advances the draft to my next pick, and survives a reload", async ({ page, fixture, consoleErrors }) => {
    expect(fixture).not.toBeNull();
    const me = fixture!.viewerTeam!;

    // arrive the way a player does: open the app, and it takes me to the stage I am in
    await page.goto("/");
    await expect(page).toHaveURL(/#\/draft$/);
    const onTheClock = page.getByRole("status").filter({ hasText: "You're on the clock" });
    await expect(onTheClock).toBeVisible();
    await dismissOnTheClock(page);

    // the draft the browser built is the draft the Node build derived: same order, from the same seed and salt
    const opening = (await readSave(page))!;
    const nodeOrder = readSummary(process.env.E2E_FIXTURE_DIR!).draftPickOrder;
    expect(opening.seed).toBe(fixture!.seed);
    expect(opening.draftSalt).toBe(fixture!.seed * 31);
    expect(opening.draft!.pickOrder).toEqual(nodeOrder);
    const myFirst = opening.draft!.pickOrder.indexOf(me);
    expect(opening.draft!.currentPickIndex, "the board was swept up to my first pick").toBe(myFirst);
    expect(opening.draft!.results).toHaveLength(myFirst);
    const rosterBefore = opening.rosterCount;

    // choose a specific player (not the suggestion): the third on the board, by its accessible name
    const draftButtons = page.getByRole("table").getByRole("button", { name: /^Draft / });
    const target = draftButtons.nth(2);
    const label = (await target.getAttribute("aria-label"))!;
    const playerName = label.replace(/^Draft /, "");
    await expect(target).toBeEnabled();
    await target.click();
    await page.getByRole("dialog").getByRole("button", {name:"Confirm pick",exact:true}).click();

    // the saved league now has that pick for my team, and the draft has moved on to my next turn
    await expect
      .poll(async () => (await readSave(page))!.draft!.results.length, { message: "the pick was recorded" })
      .toBeGreaterThan(myFirst);
    const after = (await readSave(page))!;
    const pick = after.draft!.results[myFirst]!;
    expect(pick.teamCode).toBe(me);
    expect(pick.name).toBe(playerName);
    expect(pick.team).toBe(me);
    expect(after.rosterCount).toBe(rosterBefore + 1);
    const myNext = after.draft!.pickOrder.indexOf(me, myFirst + 1);
    expect(after.draft!.currentPickIndex, "the other teams picked until it was my turn again").toBe(myNext);
    // nobody else got the same player
    expect(after.draft!.results.filter((r) => r.name === playerName)).toHaveLength(1);
    await expect(onTheClock).toBeVisible();

    // reload: the league comes back exactly as it was left, and the player is still mine
    await page.reload();
    await expect(page).toHaveURL(/#\/draft$/);
    await expect(onTheClock).toBeVisible();
    await dismissOnTheClock(page);
    const reloaded = (await readSave(page))!;
    expect(reloaded.draft!.currentPickIndex).toBe(after.draft!.currentPickIndex);
    expect(reloaded.draft!.results).toEqual(after.draft!.results);
    expect(reloaded.rosterCount).toBe(after.rosterCount);
    expect(consoleErrors).toEqual([]);
  });

  test("a player who has been taken is no longer on the board", async ({ page }) => {
    await page.goto("/");
    const onTheClock = page.getByRole("status").filter({ hasText: "You're on the clock" });
    await expect(onTheClock).toBeVisible();
    await dismissOnTheClock(page);
    const buttons = page.getByRole("table").getByRole("button", { name: /^Draft / });
    await buttons.first().click();
    await page.getByRole("dialog").getByRole("button", {name:"Confirm pick",exact:true}).click();
    await expect.poll(async () => (await readSave(page))!.draft!.results.length).toBeGreaterThan(2);
    const once = (await readSave(page))!;
    // the board has moved on to my next pick, 59 picks later in a snake draft; the players taken are gone from it
    const taken = new Set(once.draft!.results.map((r) => r.name));
    const remaining = await buttons.evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? "").replace(/^Draft /, "")));
    expect(remaining.filter((n) => taken.has(n))).toEqual([]);
  });
});
