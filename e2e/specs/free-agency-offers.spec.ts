import type { Page } from "@playwright/test";

import { type Ledger, millions, mySignings, readLedger, readPlayer, tenths } from "../support/ledger.ts";
import { expect, test } from "../support/test.ts";

/**
 * Real offers in a real free-agency market (solo play), through the screens a player uses.
 *
 * The market: five rounds, one offer or pass per team per round, and nothing signs until a round ends. A player takes
 * the best offer that is at least his asking price; the cap and the roster limit are suspended while bidding and come
 * back at the summary. The save is the first arrival at the mid-season market (the same engine and screens as the
 * offseason market, with a smaller pool), built by playing the game's own stage machine.
 *
 * What is deterministic, and so what is asserted:
 *   - an offer below the asking price cannot be made at all, and one above the league's maximum is refused by the rules;
 *   - an offer well above what any other team will pay is accepted when the round ends (the players score offers on the
 *     salary against his asking price, capped, and on fit, which counts for less: at three times the asking price no
 *     CPU team's offer can beat it);
 *   - what is then saved is exactly what was offered, in the player, the roster and the books.
 * Which of two close offers a player prefers is a matter of fit and is not pinned here.
 */
const BOARD = /#\/free-agency-board$/;
const SUMMARY = /#\/free-agency-summary$/;
const myTurn = (page: Page) => page.getByText(/You.re up\. Make one offer or pass\./);
const passRound = (page: Page) => page.getByRole("button", { name: "Pass this round" });
const offerGroup = (page: Page, name: string) => page.getByRole("group", { name: `Offer to ${name}` });

/** The player at the top of the board right now (the board is sorted by value), by name. */
async function topOfBoard(page: Page): Promise<string> {
  const label = await page.getByRole("button", { name: /^Offer / }).first().getAttribute("aria-label");
  return label!.replace(/^Offer /, "");
}

/** Opens the offer form for a player and reads what he asks. */
async function openOffer(page: Page, name: string): Promise<{ ask: number }> {
  await page.getByRole("button", { name: `Offer ${name}` }).click();
  const box = offerGroup(page, name);
  await expect(box).toBeVisible();
  const text = await box.innerText();
  const ask = /asking \$([\d.]+)M\/yr/.exec(text);
  expect(ask, "the form says what he is asking").not.toBeNull();
  return { ask: Number(ask![1]) };
}

async function fillOffer(page: Page, name: string, salary: number, years: number): Promise<void> {
  const box = offerGroup(page, name);
  await box.getByRole("spinbutton").fill(String(salary));
  await box.getByRole("combobox").selectOption(String(years));
}

/** Waits for the market to be at `round` with my team on the clock again (everyone else has played theirs). */
async function untilRound(page: Page, round: number): Promise<Ledger> {
  await expect.poll(async () => (await readLedger(page)).round, { message: `the market reached round ${round}` }).toBe(round);
  const l = await readLedger(page);
  expect(l.onTheClock).toBe(l.me);
  return l;
}

/** What a signing must look like in the player, if the game kept to what was offered (`offerToContract`). */
function expectedContract(team: string, salary: number, years: number) {
  return { team_id: team, years_remaining: years, total_value: tenths(salary * years), guaranteed: 0, cap_hit_by_year: Array.from({ length: years }, () => salary), signing_bonus: 0 };
}

test.describe("offers in the mid-season market", () => {
  test.use({ fixtureName: "midseason-fa" });

  test("an offer made through the form is accepted at the end of the round, and what is saved is exactly what was offered", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    const before = await readLedger(page);
    expect(before.round).toBe(1);
    expect(before.onTheClock).toBe(before.me);
    expect(before.offers).toEqual([]);
    const room = tenths(before.capTotal - before.capUsed - before.capDead);

    // the form opens at his asking price and three years, and says what the offer does to the cap
    const target = await topOfBoard(page);
    const { ask } = await openOffer(page, target);
    const box = offerGroup(page, target);
    await expect(box.getByRole("spinbutton")).toHaveValue(String(ask));
    await expect(box.getByRole("combobox")).toHaveValue("3");
    await expect(box).toContainText(`Cap room now ${millions(room)}`);

    // three times what he asks, for four years: more than anyone else will pay him
    const salary = tenths(ask * 3);
    await fillOffer(page, target, salary, 4);
    await expect(box).toContainText(`${millions(tenths(room - salary))} if he signs`);
    await box.getByRole("button", { name: "Submit offer" }).click();

    // the turn is spent, the league plays the round, and it is my turn again in round 2
    const after = await untilRound(page, 2);
    const offer = after.offers.find((o) => o.name === target);
    expect(offer, "the offer is on file").toMatchObject({ salary, years: 4, round: 1 });
    expect(after.offers).toHaveLength(1);

    // accepted: the market's record, the player, the roster and the books all agree, and match the offer
    const won = mySignings(after);
    expect(won).toHaveLength(1);
    expect(won[0]).toMatchObject({ salary, years: 4, round: 1, teamCode: before.me });
    const player = await readPlayer(page, offer!.playerId);
    expect(player).toMatchObject({ name: target, team: before.me, freeAgent: false });
    expect(player.contract).toEqual(expectedContract(before.me, salary, 4));
    expect(after.roster).toEqual([...before.roster, offer!.playerId].sort());
    expect(after.capUsed, "the books carry his first-year cap hit and nothing else changed").toBe(tenths(before.capUsed + salary));
    expect(after.capDead).toBe(before.capDead);

    // and the screen says so
    await expect(page.getByText("Round 1 · your bids")).toBeVisible();
    const row = page.locator(".neg-row").filter({ hasText: target });
    await expect(row).toContainText("Signed with you");
    await expect(row).toContainText(`${millions(salary)}/yr × 4y`);
    await expect(page.getByText("Your offers out").locator("xpath=following-sibling::*[1]")).toHaveText("0");

    // the Signed tab lists him with the terms
    await page.getByRole("tab", { name: /^Signed \(/ }).click();
    await expect(page.getByText(`Round 1 · ${millions(salary)}/yr × 4y`)).toBeVisible();

    // none of it is lost on a reload
    await page.reload();
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    const reloaded = await readLedger(page);
    expect(reloaded).toEqual(after);
    expect(await readPlayer(page, offer!.playerId)).toEqual(player);
    await expect(page.locator(".neg-row").filter({ hasText: target })).toContainText("Signed with you");
  });

  test("an offer the game will not take is refused with the turn unspent: below his ask, beyond the league's maximum, and nothing is saved", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    const before = await readLedger(page);

    const target = await topOfBoard(page);
    const { ask } = await openOffer(page, target);
    const box = offerGroup(page, target);
    const salary = box.getByRole("spinbutton");
    const submit = box.getByRole("button", { name: "Submit offer" });
    const below = box.getByText("Below his asking price");

    // below the asking price: he cannot accept it, so the form will not send it. At exactly the asking price it will.
    await salary.fill(String(tenths(ask - 0.1)));
    await expect(below).toBeVisible();
    await expect(submit).toBeDisabled();
    await salary.fill("0");
    await expect(submit).toBeDisabled();
    await salary.fill(String(ask));
    await expect(below).toBeHidden();
    await expect(submit).toBeEnabled();

    // beyond what any deal can pay: the form sends it and the rules refuse it, in words, and the form stays open
    await salary.fill("500");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByText(/No deal can pay more than \$\d+(\.\d)?M a year\./)).toBeVisible();
    await expect(box).toBeVisible();

    // nothing happened: still round 1, still my turn, no offer, no signing, the same books; and a reload agrees
    const unchanged = async () => {
      const l = await readLedger(page);
      expect(l).toEqual(before);
    };
    await unchanged();
    await page.reload();
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    await unchanged();

    // and the turn is still mine to use: cancelling closes the form and a pass takes it
    await page.getByRole("button", { name: `Offer ${target}` }).click();
    await offerGroup(page, target).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(offerGroup(page, target)).toBeHidden();
    await passRound(page).click();
    await untilRound(page, 2);
  });

  test("three rounds of offers with different terms, then the summary: every signing is what was offered, the books add up, and the cap that was suspended comes back", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/");
    await expect(page).toHaveURL(BOARD);
    await expect(myTurn(page)).toBeVisible();
    const start = await readLedger(page);

    // one offer a round, each for a different length, each three times the ask: three signings, the last two beyond the cap
    const years = [1, 2, 5];
    const made: Array<{ playerId: string; name: string; salary: number; years: number; round: number }> = [];
    for (let round = 1; round <= 3; round++) {
      const l = await untilRound(page, round);
      expect(l.stage).toBe("midseasonFreeAgency");
      const name = await topOfBoard(page);
      const { ask } = await openOffer(page, name);
      const salary = tenths(ask * 3);
      await fillOffer(page, name, salary, years[round - 1]!);
      await offerGroup(page, name).getByRole("button", { name: "Submit offer" }).click();
      const after = await untilRound(page, round + 1);
      const offer = after.offers.find((o) => o.name === name && o.round === round)!;
      expect(offer, `round ${round}: the offer is on file`).toMatchObject({ salary, years: years[round - 1] });
      const player = await readPlayer(page, offer.playerId);
      expect(player, `round ${round}: he signed with me`).toMatchObject({ team: start.me, freeAgent: false });
      expect(player.contract, `round ${round}: on the terms offered`).toEqual(expectedContract(start.me, salary, years[round - 1]!));
      made.push(offer);
      expect(after.roster).toHaveLength(start.roster.length + round);
      expect(after.capUsed).toBe(tenths(start.capUsed + made.reduce((n, o) => n + o.salary, 0)));
      // the ticker counts every signing in the market, mine among them
      await expect(page.getByText("Signed so far").locator("xpath=following-sibling::*[1]")).toHaveText(String(after.signed.length));
      if (round === 2) {
        // a reload between rounds loses none of it, and the market goes on from where it was
        await page.reload();
        await expect(page).toHaveURL(BOARD);
        expect(await readLedger(page)).toEqual(after);
      }
    }

    // rounds four and five: nothing more to offer; the market closes by itself after round five
    for (let round = 4; round <= 5; round++) {
      await untilRound(page, round);
      await passRound(page).click();
    }
    await expect(page).toHaveURL(SUMMARY);
    await expect.poll(async () => (await readLedger(page)).stage).toBe("midseasonFreeAgencySummary");
    const end = await readLedger(page);
    expect(end).toMatchObject({ complete: true, round: 5 });
    expect(mySignings(end).map((x) => x.playerId).sort()).toEqual(made.map((o) => o.playerId).sort());
    for (const o of made) expect(mySignings(end).find((x) => x.playerId === o.playerId)).toMatchObject({ salary: o.salary, years: o.years, round: o.round });

    // the summary shows the books as the game keeps them: contracts plus dead money, and the roster that was built
    const spent = tenths(made.reduce((n, o) => n + o.salary, 0));
    expect(end.capUsed).toBe(tenths(start.capUsed + spent));
    const booked = tenths(end.capUsed + end.capDead);
    const stat = (label: string) => page.getByText(label, { exact: true }).locator("xpath=following-sibling::*[1]");
    await expect(stat("Cap used")).toHaveText(millions(booked));
    await expect(stat("Cap space")).toHaveText(millions(tenths(end.capTotal - booked)));
    await expect(stat("Roster")).toHaveText(`${end.roster.length} / 53`);
    await expect(stat("Signed")).toHaveText("3");
    expect(end.roster).toHaveLength(start.roster.length + 3);

    // the suspended limits are back: the roster and the cap are over, so the league will not move on until they are fixed
    expect(end.roster.length).toBeGreaterThan(53);
    expect(end.capUsed).toBeGreaterThan(end.capTotal);
    await expect(page.getByRole("button", { name: "Roster not legal" })).toBeDisabled();

    // the player's staff makes it legal, and the league can go on
    await page.getByRole("button", { name: "Let my staff fix the roster" }).click();
    await page.getByRole("button", { name: "Fix the roster", exact: true }).click();
    await expect(page.getByRole("button", { name: "Roster not legal" })).toBeHidden();
    const legal = await readLedger(page);
    expect(legal.roster.length).toBeLessThanOrEqual(53);
    expect(legal.capUsed).toBeLessThanOrEqual(legal.capTotal);
    const advance = page.getByRole("button", { name: "Advance to Re-order Depth Chart" });
    await expect(advance).toBeEnabled();
    await advance.click();
    await expect.poll(async () => (await readLedger(page)).stage, { message: "the league moved on past free agency" }).toBe("midseasonDepthChart");

    // and a reload finds it there, with the books as they were left
    await page.reload();
    const final = await readLedger(page);
    expect(final.stage).toBe("midseasonDepthChart");
    expect(final.roster).toEqual(legal.roster);
    expect(final.capUsed).toBe(legal.capUsed);
  });
});
