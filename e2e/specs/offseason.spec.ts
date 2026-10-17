import type { Page } from "@playwright/test";

import {
  contractProblems,
  expectDraftValid,
  expectHistoryKept,
  expectIdentity,
  expectRetirements,
  type League,
  legalProblems,
  readLeague,
  retiredIds,
  rookieOf,
  rosterOf,
  stable,
} from "../support/offseason.ts";
import { expectSeasonConsistent, readSeason, scheduledIn, teamIdentity } from "../support/season.ts";
import { expect, test } from "../support/test.ts";

/**
 * A finished season through the offseason and into the next, with the real controls.
 *
 * The save is the first arrival after the Super Bowl in a playthrough of the game's own stage machine: the season is over and scored
 * (champion, awards, every team's season and the human GM's history recorded), the offseason not begun. The test then does what a
 * player does, stage by stage: the end-of-season screens and the hot seat, the retirement review, the rookie draft (the human's own
 * seven picks), the rookie signings, free agency and the roster fix, training camp, the depth chart, the start of the next season,
 * the preseason, and the first week of the regular season. Nothing is set by hand and no result is made up.
 *
 * What is checked, from the saved league and from the screens, at the boundaries:
 *   - the season that ended stays on the record, once and unchanged (champion, runner-up, every team's season, awards, history), and
 *     the League History screen shows it; the league year turns exactly once, and every player ages exactly once with it;
 *   - the same thirty-two franchises, the same human GM on the same team; retirements happen once and never undone, and nobody retired
 *     is on a roster; released players are on the market, not on a team;
 *   - the draft: 224 picks, nobody twice, each by the team the order gave it, worst record first; the rookies end up with the team
 *     that picked them (or released, never on another team);
 *   - contracts carry forward untouched and every team that takes the field is full, legal and under the cap; records, standings and
 *     schedule start again, and the next season's first week is simulated once and adds up;
 *   - and a reload at every boundary changes nothing: no second retirement, no draft reset, no second year, no rewritten champion.
 */
const CONTINUE = /^Continue/;
const lastRole = (page: Page, name: string | RegExp) => page.getByRole("button", { name });

/** The browser's confirmation dialogs are cancelled unless told otherwise. */
function acceptDialogs(page: Page): string[] {
  const said: string[] = [];
  page.on("dialog", (d) => {
    said.push(d.message());
    void d.accept();
  });
  return said;
}

async function stageIs(page: Page, ...stages: string[]): Promise<League> {
  await expect.poll(async () => stages.includes((await readLeague(page)).stage), { message: `the league reached ${stages.join(" or ")}` }).toBe(true);
  return readLeague(page);
}

/** Reloads, and requires the league to be exactly as it was and the player to be where they were. */
async function reloadChangesNothing(page: Page, where: RegExp, what: string): Promise<League> {
  const before = await readLeague(page);
  await page.reload();
  await expect(page).toHaveURL(where);
  const after = await readLeague(page);
  expect(stable(after), `a reload ${what} changes nothing`).toEqual(stable(before));
  return after;
}

const mainText = async (page: Page) => (await page.locator("main").innerText()).replace(/\s+/g, " ");

/** The League History screen, reached the way a player reaches it: the champions list names each season's champion and runner-up. */
async function expectChampionOnHistoryScreen(page: Page, l: League, season: number): Promise<void> {
  await page.getByRole("link", { name: "League History" }).first().click();
  await expect(page).toHaveURL(/#\/history$/);
  const champ = l.champions.find((c) => c.season === season)!;
  const name = teamIdentity(champ.champion).label.replace(/[.]/g, "[.]");
  await expect(page.locator("main"), `League History: ${season}'s champion`).toContainText(new RegExp(`Champions\\s*${season}\\s*${name}\\s*over\\s*${champ.runnerUp}`));
}

test.describe("the offseason", () => {
  test.use({ fixtureName: "end-of-season" });

  test("from the Super Bowl to the next season's first week: history kept, the year turns once, the draft and rosters hold, and no reload repeats anything", async ({ page }) => {
    test.setTimeout(480_000);
    const dialogs = acceptDialogs(page);
    await page.goto("/");
    await expect(page).toHaveURL(/#\/end-of-season$/);

    // ---- the season is over and scored, before the offseason begins
    const base = await readLeague(page);
    const S = base.season;
    expect(base.stage).toBe("endOfSeasonAnnounce");
    expect(base.hasBracket && base.bracketChampion, "the Super Bowl was played: there is a champion").toBeTruthy();
    expect(base.champions.find((c) => c.season === S), `${S}'s champion is on the record, and is the Super Bowl winner`).toMatchObject({ season: S, champion: base.bracketChampion });
    expect(base.teamSeasons.filter((r) => r.season === S), "every team's season is on the record").toHaveLength(32);
    expect(base.teamSeasons.filter((r) => r.season === S && r.finish === "champion").map((r) => r.team)).toEqual([base.bracketChampion]);
    expect(base.awards.filter((a) => a.season === S).length, "the season's awards are named").toBeGreaterThanOrEqual(4);
    expect(base.history.filter((h) => h.season === S), "the human GM's season is in their history").toHaveLength(1);
    expect(contractProblems(base), "contracts are real at the end of the season").toEqual([]);
    const me = base.me;
    for (const a of base.awards.filter((x) => x.season === S).slice(0, 4)) await expect(page.locator("main"), `the end-of-season screen names ${a.name}`).toContainText(a.name);
    await reloadChangesNothing(page, /#\/end-of-season$/, "on the end-of-season screen");

    // ---- the end-of-season screens and the hot seat
    await lastRole(page, CONTINUE).first().click();
    await stageIs(page, "endOfSeasonConsolation", "endOfSeasonWin");
    await lastRole(page, CONTINUE).first().click();
    await stageIs(page, "offseasonHotSeat");
    await expect(page).toHaveURL(/#\/hot-seat$/);
    const hotSeat = await reloadChangesNothing(page, /#\/hot-seat$/, "on the hot seat");
    expect(hotSeat.season, "the offseason is still the old league year").toBe(S);
    await lastRole(page, CONTINUE).first().click();

    // ---- the retirement review: nobody has retired yet
    const review = await stageIs(page, "offseasonRetirement");
    await expect(page).toHaveURL(/#\/retirement$/);
    expect(retiredIds(review), "the review shows who will retire; it does not retire them").toEqual(retiredIds(base));
    expectHistoryKept(review, base);
    await expectChampionOnHistoryScreen(page, review, S);
    await page.goBack();
    await expect(page).toHaveURL(/#\/retirement$/);
    await reloadChangesNothing(page, /#\/retirement$/, "on the retirement review");

    // ---- leaving it retires them, once
    await lastRole(page, "Advance to the Draft").click();
    const drafting = await stageIs(page, "offseasonDraft");
    const newlyRetired = retiredIds(drafting).filter((id) => !retiredIds(base).includes(id));
    expect(newlyRetired.length, "players retired as the review closed").toBeGreaterThan(0);
    expectRetirements(drafting, base);
    expectIdentity(drafting, base);
    expectHistoryKept(drafting, base);
    expectDraftValid(drafting, base, false);
    expect(drafting.season).toBe(S);
    const atDraft = await reloadChangesNothing(page, /#\/draft$/, "at the start of the draft (no second retirement, no new draft)");
    expect(retiredIds(atDraft)).toEqual(retiredIds(drafting));

    // ---- the rookie draft: the human's own picks, one real click each
    const mine: Array<{ n: number; name: string; id: string }> = [];
    for (let i = 0; i < 10; i++) {
      const now = await readLeague(page);
      if (now.stage !== "offseasonDraft") break;
      const overlay = page.getByRole("dialog").filter({ hasText: "on the clock" });
      if (await overlay.isVisible()) await overlay.click();
      const button = page.getByRole("button", { name: /^Draft / }).first();
      const name = (await button.evaluate((el) => el.getAttribute("aria-label") ?? el.textContent ?? "")).trim().replace(/^Draft /, "");
      const before = now.draft!.results.length;
      await button.click();
      await expect.poll(async () => { const x = await readLeague(page); return x.stage !== "offseasonDraft" || x.draft!.results.length > before; }, { message: `pick ${before + 1} was made` }).toBe(true);
      const after = await readLeague(page);
      const pick = after.draft!.results[before]!;
      expect(pick, "the click made the human's pick: this team, this player").toMatchObject({ team: me, name });
      mine.push({ n: pick.n, name, id: pick.id! });
      expectDraftValid(after, base, false);
      if (i === 2) {
        // mid-draft: the board is not reset, no pick is made again
        const kept = await reloadChangesNothing(page, /#\/draft$/, "in the middle of the draft");
        expect(kept.draft!.results.length).toBe(after.draft!.results.length);
      }
    }
    const drafted = await stageIs(page, "offseasonDraftSummary");
    expect(mine, "the human GM made seven picks").toHaveLength(7);
    expectDraftValid(drafted, base, true);
    expect(drafted.draft!.results.filter((r) => r.team === me).map((r) => r.id), "and they are the human team's seven picks").toEqual(mine.map((m) => m.id));
    await reloadChangesNothing(page, /#\/draft$/, "with the draft complete");
    await page.getByRole("dialog").first().click();
    await expect(page).toHaveURL(/#\/rookie-draft-summary$/);

    // ---- the rookie signings
    await lastRole(page, "Continue to Rookie Signings").click();
    expect(dialogs.join(" | ")).toContain("Continue to Rookie Signings");
    await expect(page).toHaveURL(/#\/rookie-signings$/);
    await lastRole(page, "Sign all remaining").click();
    await expect.poll(async () => { const x = await readLeague(page); return mine.every((m) => x.players[rookieOf(m.id)]?.team === me && !x.players[rookieOf(m.id)]!.fa); }, { message: "the rookies are signed" }).toBe(true);
    const signedNow = await readLeague(page);
    for (const m of mine) expect(signedNow.players[rookieOf(m.id)], `${m.name}: on the human team, under contract`).toMatchObject({ team: me, fa: false, retired: false });
    for (const m of mine) expect(signedNow.players[rookieOf(m.id)]!.hit, `${m.name}: a real rookie contract`).toBeGreaterThan(0);
    await reloadChangesNothing(page, /#\/rookie-signings$/, "after signing the rookies (none signed twice)");
    await lastRole(page, "Continue to Free Agency").click();

    // ---- free agency opens: every other team has signed its class, each rookie with the team that picked him
    const market = await stageIs(page, "freeAgency");
    for (const r of market.draft!.results) {
      const p = market.players[rookieOf(r.id!)];
      expect(p, `${r.name} exists`).toBeTruthy();
      expect(p, `pick ${r.n} (${r.name}) is with ${r.team}`).toMatchObject({ team: r.team, fa: false, retired: false });
    }
    expect(drafted.draft, "the draft is what it was").toEqual(market.draft);
    await page.getByRole("checkbox", { name: /Skip free agency/ }).click();
    const afterMarket = await stageIs(page, "freeAgencySummary");
    await expect(page).toHaveURL(/#\/free-agency-summary$/);

    // ---- the roster is over the limit with the rookies in; the staff releases to fit, and the released are on the market
    const over = rosterOf(afterMarket, me);
    expect(over.length, "the human roster is over the limit before the fix").toBeGreaterThan(53);
    await lastRole(page, "Let my staff fix the roster").click();
    await page.getByRole("button", { name: "Fix the roster", exact: true }).click();
    await expect.poll(async () => rosterOf(await readLeague(page), me).length).toBe(53);
    const fixed = await readLeague(page);
    const released = over.filter((p) => !rosterOf(fixed, me).some((q) => q.id === p.id));
    expect(released.length, "the fix released the surplus").toBe(over.length - 53);
    for (const p of released) expect(fixed.players[p.id], `${p.id} was released: on the market, not on a roster`).toMatchObject({ fa: true });
    expectRetirements(fixed, drafting);
    await reloadChangesNothing(page, /#\/free-agency-summary$/, "after the roster fix (nobody released twice)");
    await lastRole(page, "Advance to Training Camp").click();

    // ---- training camp: players develop; the league year has not turned
    const camp = await stageIs(page, "trainingCamp");
    expect(camp.season).toBe(S);
    await page.getByRole("button", { name: /^Quarterbacks/ }).click();
    await page.getByRole("button", { name: /^Defensive line/ }).click();
    await lastRole(page, "Advance to End of Training Camp").click();
    await expect(page).toHaveURL(/#\/training-camp-results$/);
    const afterCamp = await readLeague(page);
    const moved = rosterOf(afterCamp, me).filter((p) => camp.players[p.id] && camp.players[p.id]!.overall !== p.overall);
    expect(moved.length, "camp changed some of the team's players").toBeGreaterThan(0);
    for (const p of Object.values(afterCamp.players)) if (camp.players[p.id]) expect(p.age, "camp does not age anyone").toBe(camp.players[p.id]!.age);
    await reloadChangesNothing(page, /#\/training-camp-results$/, "on the camp results (the camp is not run again)");
    await lastRole(page, "Advance to Re-order Depth Chart").click();
    const preRollover = await stageIs(page, "offseasonDepthChart", "hoodedFigureEncounter");
    expect(preRollover.season, "still the old league year until the season starts").toBe(S);
    await reloadChangesNothing(page, /#\/roster$/, "on the depth chart");

    // ---- the next season starts: the year turns once, everyone ages once, the record is kept, the books are legal
    await lastRole(page, "Ready to start the season").click();
    const next = await stageIs(page, "preseason");
    expect(next.season, "the league year turned exactly once").toBe(S + 1);
    expect(next.week).toBe(1);
    for (const p of Object.values(next.players)) {
      const was = preRollover.players[p.id];
      if (was && !was.retired && !p.retired) expect(p.age, `${p.id} aged exactly one year`).toBe(was.age + 1);
    }
    expectIdentity(next, base);
    expectHistoryKept(next, base);
    expect(next.champions.every((c) => c.season <= S) && next.teamSeasons.every((r) => r.season <= S) && next.awards.every((a) => a.season <= S), "nothing is recorded for a season not yet played").toBe(true);
    expect(next.hasBracket, "last season's bracket is gone, its champion is on the record").toBe(false);
    expectRetirements(next, fixed);
    expect(legalProblems(next), "every team that will take the field is full, under the cap, on real contracts").toEqual([]);

    // contracts carry forward: a player who stayed with his team has the contract he had at the end of the season: never shortened again
    // (the year was already taken off at season's end), the salary never rewritten; the only change the game makes is a CPU team
    // extending a player (same salary, more years)
    let stayed = 0;
    let extended = 0;
    for (const p of Object.values(next.players)) {
      const was = base.players[p.id];
      if (!was || was.retired || was.fa || p.retired || p.fa || was.team !== p.team) continue;
      stayed++;
      expect(p.years, `${p.id}: the contract was not shortened a second time`).toBeGreaterThanOrEqual(was.years);
      expect(p.hit, `${p.id}: the salary was not rewritten`).toBe(was.hit);
      if (p.years === was.years) expect(p.hits, `${p.id}: an unchanged contract is unchanged`).toBe(was.hits);
      else extended++;
    }
    expect(stayed, "most of the league's players stayed where they were").toBeGreaterThan(1000);
    expect(extended, "a few CPU extensions, not a rewrite of the league").toBeLessThan(stayed / 20);

    // the draft class: with the team that picked it when the market opened (checked above, all 224); by the start of the season most are
    // still there or on its practice squad, a cut one is on the market or with whoever signed him since, and one who was cut and found
    // no job is pruned as the year turns: never a rookie who was under contract
    let kept = 0;
    for (const r of market.draft!.results) {
      const p = next.players[rookieOf(r.id!)]!;
      if (p.retired) {
        expect(preRollover.players[rookieOf(r.id!)]!.fa, `${r.name} retired, but was not on the market before the year turned`).toBe(true);
        continue;
      }
      if (p.team === r.team || p.team === `PS:${r.team}`) kept++;
    }
    expect(kept, "most of the draft class is still with the team that picked it").toBeGreaterThan(150);
    expect(next.draft, "this year's draft is over and cleared").toBeNull();

    // standings and schedule start again
    for (const code of next.teamCodes) expect(next.teams[code], `${code}'s record starts at nothing`).toMatchObject({ w: 0, l: 0, t: 0, pf: 0, pa: 0 });
    expect(next.gameCounts, "no game of the new season has been played").toEqual({ PRE: 0, REG: 0, other: 0 });
    const reg = next.schedule.filter((g) => g.phase === "REG");
    expect(reg, "a full new schedule").toHaveLength(272);
    for (const code of next.teamCodes) expect(reg.filter((g) => g.home === code || g.away === code), `${code} plays seventeen`).toHaveLength(17);
    const again = await reloadChangesNothing(page, /#\/hub$/, "after the season starts (the year does not turn again, nobody ages again)");
    expect(again.season).toBe(S + 1);
    await expectChampionOnHistoryScreen(page, again, S);
    await page.getByRole("link", { name: "Weekly Team Hub" }).first().click();
    await expect(page).toHaveURL(/#\/hub$/);

    // ---- the preseason, then the regular season's first week, simulated once
    for (let week = 1; week <= 3; week++) {
      await expect(page).toHaveURL(/#\/hub$/);
      await lastRole(page, "Ready for Game Day").click();
      await expect(page).toHaveURL(/#\/game-day$/);
      await expect.poll(async () => (await readLeague(page)).gameCounts.PRE).toBe(16 * week);
      await lastRole(page, CONTINUE).click();
      if (week < 3) await stageIs(page, "preseason");
    }
    const opener = await stageIs(page, "regularSeason");
    expect(opener).toMatchObject({ season: S + 1, week: 1 });
    expect(opener.gameCounts.REG, "preseason games do not count").toBe(0);
    for (const code of opener.teamCodes) expect(opener.teams[code], `${code} is 0-0`).toMatchObject({ w: 0, l: 0, t: 0 });
    await reloadChangesNothing(page, /#\/hub$/, "on the regular season's first hub");

    await lastRole(page, "Ready for Game Day").click();
    await expect(page).toHaveURL(/#\/game-day$/);
    const season = await readSeason(page);
    expect(season.stage).toBe("regularSeason");
    expect(season.games.filter((g) => g.phase === "REG"), "week one's games, each once").toHaveLength(scheduledIn(season, 1).length);
    expectSeasonConsistent(season, 1);
    const played = await reloadChangesNothing(page, /#\/game-day$/, "on Game Day (week one is not played again)");
    expect(played.gameCounts.REG).toBe(scheduledIn(season, 1).length);
    await lastRole(page, CONTINUE).click();
    const week2 = await stageIs(page, "regularSeason");
    expect(week2).toMatchObject({ season: S + 1, week: 2 });
    for (const p of Object.values(week2.players)) {
      const was = again.players[p.id];
      if (was && !was.retired && !p.retired) expect(p.age, `${p.id}: no second year of aging`).toBe(was.age);
    }
    expectHistoryKept(week2, base);
  });
});
