import type { Page } from "@playwright/test";

import {
  bracketOnScreen,
  expectBracketConsistent,
  expectedOnScreen,
  expectedOutcome,
  type Postseason,
  ROUND_NAME,
  ROUNDS,
  readPostseason,
  type Round,
} from "../support/postseason.ts";
import { authoritativeSeeding, readSeason, teamIdentity } from "../support/season.ts";
import { expect, test } from "../support/test.ts";

/**
 * The postseason, played through the screens a player uses.
 *
 * The save is the first arrival at the playoffs in a playthrough of the game's own stage machine: the regular season played
 * out, the bracket seeded by the game, nothing in it played. A round is "Simulate the <round>" on the bracket (the league
 * plays the whole round), the Game Day screen with its results, and "Continue", which goes back to the bracket for the next
 * round; after the Super Bowl it goes on to the end of the season. No participant is chosen and no result is made up.
 *
 * After every round, from the saved league alone (`expectBracketConsistent`): the field is the seeded fourteen; the one seeds
 * were on a bye; every game played has a winner that its score gives; the next round is the reseeding of those winners; no
 * team that lost ever comes back; nothing later has been played; the champion is the Super Bowl winner and not before. And on
 * the screens: each conference's bracket and the Game Day results show the same teams, seeds and scores as the save.
 */
const BRACKET = /#\/bracket$/;
const GAME_DAY = /#\/game-day$/;
const END_OF_SEASON = /#\/end-of-season$/;
const simulate = (page: Page, round: Round) => page.getByRole("button", { name: `Simulate the ${ROUND_NAME[round]}` });
const cont = (page: Page) => page.getByRole("button", { name: "Continue", exact: true });
const statBeside = (page: Page, label: string) => page.locator("p").filter({ hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::*[1]");

/** The Game Day screen lists every game of the round just played: both teams and the score. */
async function expectRoundOnGameDay(page: Page, p: Postseason, round: Round): Promise<void> {
  const text = await page.locator("main").innerText();
  expect(text, "the Game Day screen names the round").toContain(`${ROUND_NAME[round]} · results are in`);
  for (const m of p.matchups.filter((x) => x.round === round && x.low !== null)) {
    expect(text, `${m.high!.code} v ${m.low!.code}: the score on Game Day`).toContain(`${m.homeScore}–${m.awayScore}`);
    expect(text).toContain(teamIdentity(m.high!.code).label);
    expect(text).toContain(teamIdentity(m.low!.code).label);
  }
}

/** Presses the round's button and checks the league as the round leaves it. Ends on Game Day. */
async function simulateRound(page: Page, r: number, start: Postseason): Promise<Postseason> {
  const round = ROUNDS[r]!;
  const before = await readPostseason(page);
  expect(before).toMatchObject({ stage: "playoffs", round, pending: null });
  expectBracketConsistent(before, r, start.seeds);
  await expect(page).toHaveURL(BRACKET);

  await simulate(page, round).click();
  await expect(page).toHaveURL(GAME_DAY);
  await expect.poll(async () => (await readPostseason(page)).pending?.phase, { message: `${ROUND_NAME[round]} was played and saved` }).toBe(round);
  const after = await readPostseason(page);

  // exactly one round was played, and the bracket moved on by exactly one step
  expect(after.round, "the bracket moved to the next round (the Super Bowl stays)").toBe(ROUNDS[Math.min(r + 1, 3)]);
  expectBracketConsistent(after, r + 1, start.seeds);
  for (let i = 0; i < ROUNDS.length; i++) {
    const was = before.matchups.filter((m) => m.round === ROUNDS[i]);
    const now = after.matchups.filter((m) => m.round === ROUNDS[i]);
    if (i < r) expect(now, `${ROUND_NAME[ROUNDS[i]!]} was not touched`).toEqual(was);
  }
  // nothing about the regular season moved, and no postseason game is on the books twice
  expect(after.regularSeason, "the regular season is as it was").toBe(before.regularSeason);
  expect(new Set(after.postseasonGames).size, "no game recorded twice").toBe(after.postseasonGames.length);
  await expectRoundOnGameDay(page, after, round);
  return after;
}

test.describe("the postseason", () => {
  test.use({ fixtureName: "playoffs-wild-card" });

  test("all four rounds: each game is played once, the right teams advance, and the champion is the Super Bowl winner, on the screens and in the books", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await expect(page).toHaveURL(BRACKET);
    const start = await readPostseason(page);
    expect(start).toMatchObject({ stage: "playoffs", round: "WC", champion: null, pending: null });
    expect(start.postseasonGames).toEqual([]);
    expectBracketConsistent(start, 0, start.seeds);

    // the field is the one the rule book seeds from the regular season that was just played
    const rules = authoritativeSeeding(await readSeason(page));
    expect(start.seeds).toEqual({ AFC: rules.AFC.seeds, NFC: rules.NFC.seeds });

    let now = start;
    for (let r = 0; r < ROUNDS.length; r++) {
      now = await simulateRound(page, r, start);

      if (r < 3) {
        // Continue returns to the bracket, which now shows the round just played and the one to come
        await cont(page).click();
        await expect(page).toHaveURL(BRACKET);
        const back = await readPostseason(page);
        expect(back).toMatchObject({ stage: "playoffs", pending: null, round: ROUNDS[r + 1] });
        expect(back.matchups, "Continue changes nothing in the bracket").toEqual(now.matchups);
        await expect(simulate(page, ROUNDS[r + 1]!)).toBeVisible();
        await expect(simulate(page, ROUNDS[r]!)).toHaveCount(0);
        for (const conf of ["AFC", "NFC"] as const) expect(await bracketOnScreen(page, conf), `${conf}: the bracket as drawn, after the ${ROUND_NAME[ROUNDS[r]!]}`).toEqual(expectedOnScreen(back, conf));
      }
    }

    // the Super Bowl is played: its two teams are the two conference champions, and the winner is the champion
    const sb = now.matchups.find((m) => m.round === "SB")!;
    const champ = (conf: "AFC" | "NFC") => now.matchups.find((m) => m.round === "CONF" && m.conference === conf)!.winner;
    expect([sb.high!.code, sb.low!.code], "the Super Bowl is the AFC champion against the NFC champion").toEqual([champ("AFC"), champ("NFC")]);
    expect(now.champion).toBe(sb.winner);
    expect([sb.high!.code, sb.low!.code]).toContain(now.champion);

    // the bracket screen says so, and offers the result
    await page.getByRole("link", { name: "Playoff Bracket" }).click();
    await expect(page).toHaveURL(BRACKET);
    await expect(statBeside(page, "Champion")).toHaveText(teamIdentity(now.champion!).label);
    for (const conf of ["AFC", "NFC"] as const) expect(await bracketOnScreen(page, conf), `${conf}: the finished bracket`).toEqual(expectedOnScreen(now, conf));
    await page.getByRole("button", { name: "See the final result" }).click();
    await expect(page).toHaveURL(GAME_DAY);

    // the season ends: the stage moves on, the bracket is as it was, and the season's record of each team agrees with the bracket
    await cont(page).click();
    await expect(page).toHaveURL(END_OF_SEASON);
    const end = await readPostseason(page);
    expect(end.stage).toBe("endOfSeasonAnnounce");
    expect(end.matchups).toEqual(now.matchups);
    expect(end.champion).toBe(now.champion);
    expect(end.outcomes, "one record per team's GM").toHaveLength(32);
    expect(end.outcomes.filter((o) => o.wonSuperBowl).map((o) => o.team), "exactly one team is recorded as champion, and it is the Super Bowl winner").toEqual([now.champion]);
    const field = new Set([...start.seeds.AFC, ...start.seeds.NFC]);
    for (const o of end.outcomes) {
      if (!field.has(o.team)) {
        expect(o, `${o.team} missed the playoffs`).toMatchObject({ madePlayoffs: false, furthestRound: "none", wonSuperBowl: false });
        continue;
      }
      const conf = start.seeds.AFC.includes(o.team) ? "AFC" : "NFC";
      expect(o, `${o.team}'s season record agrees with the bracket`).toMatchObject({ madePlayoffs: true, seed: start.seeds[conf].indexOf(o.team) + 1, ...expectedOutcome(now, o.team) });
    }
  });

  test("a reload at every point of the postseason replays nothing: not a round, not a game, and the next round cannot be simulated twice", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/");
    await expect(page).toHaveURL(BRACKET);
    const start = await readPostseason(page);

    for (let r = 0; r < ROUNDS.length; r++) {
      const round = ROUNDS[r]!;
      const after = await simulateRound(page, r, start);

      // reload on Game Day: the round is held and shown again, the same games with the same scores, and not played again
      await page.reload();
      await expect(page).toHaveURL(GAME_DAY);
      await expectRoundOnGameDay(page, after, round);
      expect(await readPostseason(page), "the whole postseason is as it was").toEqual(after);

      // while the round's results are held, the bracket offers them and not another round to simulate
      await page.goto("/#/bracket");
      await expect(page).toHaveURL(BRACKET);
      await expect(page.getByRole("button", { name: /^Simulate the / })).toHaveCount(0);
      await expect(page.getByRole("button", { name: round === "SB" ? "See the final result" : "View round results" })).toBeVisible();
      expect(await readPostseason(page)).toEqual(after);
      await page.getByRole("button", { name: round === "SB" ? "See the final result" : "View round results" }).click();
      await expect(page).toHaveURL(GAME_DAY);

      await cont(page).click();
      if (round === "SB") {
        await expect(page).toHaveURL(END_OF_SEASON);
        await page.reload();
        await expect(page).toHaveURL(END_OF_SEASON);
        const end = await readPostseason(page);
        expect(end).toMatchObject({ stage: "endOfSeasonAnnounce", champion: after.champion });
        expect(end.matchups).toEqual(after.matchups);
        expect(end.outcomes.filter((o) => o.wonSuperBowl).map((o) => o.team)).toEqual([after.champion]);
        continue;
      }

      // reload on the bracket between rounds: the next round is waiting, unplayed, and the one just played is not offered again
      await expect(page).toHaveURL(BRACKET);
      await page.reload();
      await expect(page).toHaveURL(BRACKET);
      const waiting = await readPostseason(page);
      expect(waiting).toMatchObject({ round: ROUNDS[r + 1], pending: null });
      expect(waiting.matchups).toEqual(after.matchups);
      expectBracketConsistent(waiting, r + 1, start.seeds);
      await expect(simulate(page, ROUNDS[r + 1]!)).toBeVisible();
      await expect(simulate(page, round)).toHaveCount(0);
    }
  });
});
