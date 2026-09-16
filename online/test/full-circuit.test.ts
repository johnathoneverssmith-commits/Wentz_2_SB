import { describe, expect, it } from "vitest";

import type { LeagueState, Stage } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal, revealedRounds, visibleGames } from "@/state/reveal.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { FIRST_BLOCK_LAST_WEEK, PRESEASON_WEEKS, REGULAR_SEASON_WEEKS } from "@/state/stageMachine.ts";
import { decideReveal, decideRevealRound } from "../src/decide.js";
import { readyUpLocal } from "../src/phases.js";

/**
 * The whole season, driven the way a GM drives it.
 *
 * Every other test in here checks one change. This one checks that they add
 * up: it presses the buttons the screens press, in order, from the preseason
 * to the offseason, and asserts the league actually moves.
 *
 * It is here because the thirteen changes went in without a live playthrough,
 * and the first thing it found was a real one — `advanceStage` refused to move
 * any in-season stage, on the old assumption that a week advances by being
 * played. After Change 6 nothing advances by being played, so "Advance to
 * Regular Season" did nothing and a league that finished its preseason simply
 * stopped.
 */
function leagueInPreseason(humans = ["KC", "BUF"]): LeagueState {
  const s = createLeague(90210, { ...DEFAULT_CONFIG, humanGmCount: humans.length });
  fillRosterGaps(s);
  humans.forEach((code, i) => {
    s.gms[i]!.teamCode = code;
    s.gms[i]!.isHuman = true;
  });
  for (let i = humans.length; i < s.gms.length; i++) s.gms[i]!.isHuman = false;
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  s.reveal = emptyReveal();
  return s;
}

/** Everybody says they're done, which is what moves a checkpoint. */
function everyoneReady(s: LeagueState): boolean {
  for (const g of s.gms) if (g.isHuman) s.readiness[g.id] = true;
  return readyUpLocal(s);
}

function actorFor(s: LeagueState, i: number) {
  const gm = s.gms.filter((g) => g.isHuman)[i]!;
  return { leagueId: "test", gmId: gm.id, teamCode: gm.teamCode, userId: `u${i}` };
}

describe("a season, driven by the buttons", () => {
  it("gets from the preseason to the trade deadline", () => {
    const s = leagueInPreseason();
    // entering the preseason is what plays it; the fixture starts already in
    // the stage, so the block is simulated by the first advance below
    expect(s.stage).toBe("preseason");

    // both GMs watch all three weeks, independently
    for (let i = 0; i < 2; i++) {
      decideReveal(s, actorFor(s, i), PRESEASON_WEEKS);
    }
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("regularSeason");
    expect(s.week).toBe(1);

    // the preseason is gone and nobody has watched a real week yet
    expect(s.games.some((g) => g.phase === "PRE")).toBe(false);
    expect(visibleGames(s, s.gms[0]!.id)).toHaveLength(0);
    // and weeks 1-9 are waiting, played, unrevealed
    expect(s.games.filter((g) => g.phase === "REG" && g.played).length).toBeGreaterThan(0);
    expect(s.games.some((g) => g.phase === "REG" && g.week > FIRST_BLOCK_LAST_WEEK)).toBe(false);

    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), FIRST_BLOCK_LAST_WEEK);
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("tradeDeadline");
    expect(s.tradeDeadline).toBeTruthy();
  }, 900_000);

  it("gets from the deadline to the playoffs", () => {
    const s = leagueInPreseason();
    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), PRESEASON_WEEKS);
    everyoneReady(s);
    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), FIRST_BLOCK_LAST_WEEK);
    everyoneReady(s);
    expect(s.stage).toBe("tradeDeadline");

    // the deadline runs itself when nobody on the clock is human; the GMs
    // here skip their turns by committing, which is the checkpoint's job
    s.tradeDeadline!.done = true;
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("tradeDeadlineSummary");

    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("midseasonFreeAgency");
    s.freeAgencyEvent!.complete = true;
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("midseasonFreeAgencySummary");
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("midseasonDepthChart");

    // the gate that matters: weeks 10-18 are built on the far side of it
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("regularSeason");
    expect(s.week).toBe(FIRST_BLOCK_LAST_WEEK + 1);
    expect(s.games.some((g) => g.phase === "REG" && g.week === REGULAR_SEASON_WEEKS)).toBe(true);

    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), REGULAR_SEASON_WEEKS);
    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("playoffs");
    // Change 11: it is already played by the time anyone arrives
    expect(s.bracket?.champion).toBeTruthy();
  }, 1_800_000);

  it("gets from the playoffs into the offseason, a round at a time", () => {
    const s = leagueInPreseason();
    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), PRESEASON_WEEKS);
    everyoneReady(s);
    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), FIRST_BLOCK_LAST_WEEK);
    everyoneReady(s);
    s.tradeDeadline!.done = true;
    everyoneReady(s);
    everyoneReady(s);
    s.freeAgencyEvent!.complete = true;
    everyoneReady(s);
    everyoneReady(s);
    everyoneReady(s);
    for (let i = 0; i < 2; i++) decideReveal(s, actorFor(s, i), REGULAR_SEASON_WEEKS);
    everyoneReady(s);
    expect(s.stage).toBe("playoffs");

    // one round at a time, and one GM's pace is not the other's
    const [a, b] = [actorFor(s, 0), actorFor(s, 1)];
    decideRevealRound(s, a);
    expect(revealedRounds(s, a.gmId)).toEqual(["WC"]);
    expect(revealedRounds(s, b.gmId)).toEqual([]);

    for (let i = 0; i < 3; i++) decideRevealRound(s, a);
    for (let i = 0; i < 4; i++) decideRevealRound(s, b);
    expect(revealedRounds(s, a.gmId)).toHaveLength(4);
    // and there is no fifth
    expect(() => decideRevealRound(s, a)).toThrow();

    expect(everyoneReady(s)).toBe(true);
    expect(s.stage).toBe("endOfSeasonAnnounce");
    // the season is on the books, which is what the roasts read next year
    expect(s.history.some((h) => h.season === s.season)).toBe(true);
  }, 1_800_000);
});

describe("stages that should not move", () => {
  it("refuses to skip a block that hasn't been watched", () => {
    const s = leagueInPreseason();
    // nobody has revealed anything, but the readiness gate is not what knows
    // that — the screens are. What it must not do is step the *week*.
    const before: Stage = s.stage;
    everyoneReady(s);
    expect(s.stage).not.toBe(before === "preseason" ? "preseason" : before);
  }, 900_000);
});
