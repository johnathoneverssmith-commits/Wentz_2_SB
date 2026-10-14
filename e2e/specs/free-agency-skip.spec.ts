import type { Page } from "@playwright/test";

import { readMarket } from "../support/market.ts";
import { expect, test } from "../support/test.ts";

/**
 * "Skip free agency" and the market after it (the soft-lock of commit b757e8d, solo play).
 *
 * The choice is a setting on the human GM, and it used to outlive the market it was made in. The next market then
 * opened with the choice still on: the GM's turns were passed before they had seen the board, the market was over
 * before it began, and the league moved on past a free agency that its human never played. The fix clears the choice
 * when a market opens (`clearSkips` in `beginFreeAgencyEvent`).
 *
 * Everything here is a player's action on a real screen (the checkbox, "Pass this round", the rookie-signing and
 * summary buttons), checked twice: on the screen, and in the league the app saved. The two saves come from one
 * playthrough of the game's own stage machine (e2e/fixtures/build.ts): the first market of the mid-season, and the
 * moment before the next market, a year on, after the choice was made in the first and the league was played on.
 */
const BOARD = /#\/free-agency-board$/;
const SUMMARY = /#\/free-agency-summary$/;
const skipBox = (page: Page) => page.getByRole("checkbox", { name: /Skip free agency/ });
const passRound = (page: Page) => page.getByRole("button", { name: "Pass this round" });
/** The board's own prompt when it is my turn. */
const myTurn = (page: Page) => page.getByText(/You.re up\. Make one offer or pass\./);

/** Accepts the browser's confirmation dialogs (Playwright cancels them unless told otherwise), keeping what they said. */
function acceptDialogs(page: Page): string[] {
  const said: string[] = [];
  page.on("dialog", (d) => {
    said.push(d.message());
    void d.accept();
  });
  return said;
}

test.describe("the mid-season market", () => {
  test.use({ fixtureName: "midseason-fa" });

  test("control: with Skip free agency unchecked the market waits for me, and passing takes my turn and no one else's", async ({ page, fixture }) => {
    const me = fixture!.viewerTeam!;
    await page.goto("/");
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    await expect(skipBox(page)).not.toBeChecked();

    // saved: the market is open, round 1, and it is my team on the clock; nothing chosen, no offer made
    const open = (await readMarket(page))!;
    expect(open.stage).toBe("midseasonFreeAgency");
    expect(open.me).toBe(me);
    expect(open.skips.freeAgency ?? false).toBe(false);
    expect(open.event).toMatchObject({ round: 1, complete: false, onTheClock: me, myOffers: 0 });

    // it is waiting for me, not for a timer: nothing moves while I do nothing
    await page.waitForTimeout(1500);
    await expect(myTurn(page)).toBeVisible();
    expect((await readMarket(page))!.event).toMatchObject({ round: 1, complete: false, onTheClock: me });

    // a human turn: I pass, the rest of the league plays its round, and it is my turn again in round 2
    await passRound(page).click();
    await expect.poll(async () => (await readMarket(page))!.event?.round, { message: "the round moved on after my pass" }).toBe(2);
    const second = (await readMarket(page))!;
    expect(second.stage).toBe("midseasonFreeAgency");
    expect(second.event).toMatchObject({ round: 2, complete: false, onTheClock: me, myOffers: 0 });
    expect(second.event!.signed, "the other teams signed players in round 1").toBeGreaterThan(0);
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    await expect(skipBox(page)).not.toBeChecked();

    // and it is all still there after a reload
    await page.reload();
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    expect((await readMarket(page))!.event).toMatchObject({ round: 2, complete: false, onTheClock: me, myOffers: 0 });
  });

  test("ticking Skip free agency passes my turns, finishes this market, moves the league on, and the choice is saved", async ({ page, fixture }) => {
    const me = fixture!.viewerTeam!;
    await page.goto("/");
    await expect(page).toHaveURL(BOARD);
    await expect(skipBox(page)).not.toBeChecked();

    // not .check(): the box goes away with the market, which is the point
    await skipBox(page).click();
    await expect(page).toHaveURL(SUMMARY);
    await expect.poll(async () => (await readMarket(page))!.stage, { message: "the league moved on to the market's summary" }).toBe("midseasonFreeAgencySummary");
    const done = (await readMarket(page))!;
    expect(done.event).toMatchObject({ complete: true, onTheClock: null, myOffers: 0 });
    expect(done.event!.round).toBe(5);
    expect(done.skips.freeAgency, "the choice is saved").toBe(true);
    expect(done.me).toBe(me);

    await page.reload();
    await expect(page).toHaveURL(SUMMARY);
    const after = (await readMarket(page))!;
    expect(after.stage).toBe("midseasonFreeAgencySummary");
    expect(after.skips.freeAgency).toBe(true);
  });
});

test.describe("the next market", () => {
  test.use({ fixtureName: "offseason-fa-skip-carried" });

  test("a skip chosen in the mid-season market does not carry into the offseason market: it opens on my turn, accepts it, and the league advances", async ({ page, fixture }) => {
    test.setTimeout(180_000);
    const me = fixture!.viewerTeam!;
    const said = acceptDialogs(page);

    // the save is a year on, with the offseason market about to open. What was chosen in the mid-season market is
    // still set in the league (the builder refuses to write this save unless it is), and that market is long over
    expect(fixture!.skipFreeAgency).toBe(true);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/rookie-draft-summary$/);
    const before = (await readMarket(page))!;
    expect(before.stage).toBe("offseasonDraftSummary");
    expect(before.skips.freeAgency, "the choice from the earlier market is still set").toBe(true);
    expect(before.event, "the earlier market is the one the league still holds").toMatchObject({ complete: true });

    // the player's way to the market: the summary, the rookie signings, then free agency
    await page.getByRole("button", { name: "Continue to Rookie Signings" }).click();
    await expect(page).toHaveURL(/#\/rookie-signings$/);
    await page.getByRole("button", { name: "Sign all remaining" }).click();
    await page.getByRole("button", { name: "Continue to Free Agency" }).click();
    expect(said).toEqual([expect.stringContaining("Continue to Rookie Signings")]);

    // THE regression: the market is open and it is my turn. Carried over, it would be over already (and the league
    // would have moved on to its summary without my seeing the board)
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    await expect(skipBox(page)).not.toBeChecked();
    const open = (await readMarket(page))!;
    expect(open.stage).toBe("freeAgency");
    expect(open.skips.freeAgency ?? false, "the choice was cleared when this market opened").toBe(false);
    expect(open.event).toMatchObject({ round: 1, complete: false, onTheClock: me, myOffers: 0 });
    expect(open.event!.signed, "this is a new market, not the earlier one").toBe(0);

    // a reload does not change that
    await page.reload();
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    await expect(skipBox(page)).not.toBeChecked();
    expect((await readMarket(page))!.event).toMatchObject({ round: 1, complete: false, onTheClock: me });

    // the market takes my turns: five rounds, each one mine
    for (let round = 1; round <= 5; round++) {
      await expect(myTurn(page)).toBeVisible();
      expect((await readMarket(page))!.event).toMatchObject({ round, complete: false, onTheClock: me });
      await passRound(page).click();
      if (round < 5) await expect.poll(async () => (await readMarket(page))!.event?.round, { message: `round ${round} moved on after my pass` }).toBe(round + 1);
    }

    // the market ends, and the league moves to its summary
    await expect(page).toHaveURL(SUMMARY);
    await expect.poll(async () => (await readMarket(page))!.stage).toBe("freeAgencySummary");
    const summary = (await readMarket(page))!;
    expect(summary.event).toMatchObject({ round: 5, complete: true, myOffers: 0 });
    expect(summary.skips.freeAgency ?? false).toBe(false);

    // and through to the next stage: the roster is over the limit with the rookies in, the player's staff fixes it
    await page.getByRole("button", { name: "Let my staff fix the roster" }).click();
    await page.getByRole("button", { name: "Fix the roster", exact: true }).click();
    await expect.poll(async () => (await readMarket(page))!.rosterCount, { message: "the roster is legal" }).toBe(53);
    await page.getByRole("button", { name: "Advance to Training Camp" }).click();
    await expect(page).toHaveURL(/#\/training-camp$/);
    await expect.poll(async () => (await readMarket(page))!.stage).toBe("trainingCamp");

    await page.reload();
    await expect(page).toHaveURL(/#\/training-camp$/);
    const camp = (await readMarket(page))!;
    expect(camp.stage).toBe("trainingCamp");
    expect(camp.skips.freeAgency ?? false).toBe(false);
  });
});
