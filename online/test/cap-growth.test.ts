import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { BASE_CAP_M, CAP_GROWTH_MEAN, CAP_GROWTH_SPREAD, capGrowthRate, growCap } from "@/state/capEconomy.ts";
import { finalizeSeason } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * The salary cap's yearly rise, through the server's own season rollover.
 *
 * The cap rises in `finalizeSeason`, which the single-player store and the online server both run; here it is
 * driven the way a real league reaches it online: a season's clock run to the playoffs, a champion, and the
 * stage machine carrying the league into the next year. Like `season.test.ts` it does not play games.
 */
const sim = new MockSimulationService();

function leagueInPreseason(seed: number): LeagueState {
  const state = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  state.gms[0]!.teamCode = "KC";
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = "BUF";
  state.gms[1]!.isHuman = true;
  state.schedule = sim.generateSchedule(state.season, Object.keys(state.teams));
  state.stage = "preseason";
  state.week = 1;
  clearReadinessOnline(state);
  return state;
}

/** Play the clock to the playoffs, crown a champion, and run the stage machine until the season turns. Returns the season that ended. */
function rollOver(s: LeagueState): number {
  const ending = s.season;
  let guard = 0;
  while (s.stage !== "playoffs") {
    if (guard++ > 60) throw new Error("never reached the playoffs");
    finishPlayedWeek(s);
  }
  s.bracket!.champion = "KC";
  guard = 0;
  while (s.season === ending) {
    if (guard++ > 40) throw new Error(`stuck in ${s.stage}`);
    for (const g of s.gms) s.readiness[g.id] = true;
    if (s.stage === "playoffs") finishPlayedWeek(s);
    else advanceStage(s);
  }
  return ending;
}

describe("the cap's rise through a real online season rollover", () => {
  it("raises every team's cap once, by the league's rate for the season, the same on every team, from a save written before the cap grew", () => {
    const fresh = leagueInPreseason(4242);
    // a save from before the cap grew: the fields were never written
    const s = JSON.parse(JSON.stringify(fresh)) as LeagueState;
    delete (s as Partial<LeagueState>).capScale;
    delete (s as Partial<LeagueState>).capGrowthSeason;
    const ended = rollOver(s);
    const rate = capGrowthRate(s.seed, ended);
    expect(rate).toBeGreaterThanOrEqual(CAP_GROWTH_MEAN - CAP_GROWTH_SPREAD);
    expect(rate).toBeLessThan(CAP_GROWTH_MEAN + CAP_GROWTH_SPREAD);
    const totals = new Set(Object.values(s.teams).map((t) => t.cap.total));
    expect(totals.size, "one league-wide cap").toBe(1);
    expect([...totals][0], "rises from the starting cap, by the rate the formula gives for this league and season").toBe(Math.round(BASE_CAP_M * (1 + rate) * 10) / 10);
    expect(s.capScale).toBeCloseTo(1 + rate, 9);
    expect(s.capGrowthSeason).toBe(ended);

    // the rollover's logic run again does not raise it again: the season's close (the new season has no played games, as a
    // retried request would find it), and the growth asked for again for the season that already grew
    const after = { scale: s.capScale, total: Object.values(s.teams)[0]!.cap.total };
    finalizeSeason(s);
    s.season = ended;
    expect(growCap(s)).toBe(0);
    s.season = ended + 1;
    expect(s.capScale).toBe(after.scale);
    expect(Object.values(s.teams)[0]!.cap.total).toBe(after.total);

    // and the next season's rollover rises again, from where the cap stands
    const second = rollOver(s);
    expect(second).toBe(ended + 1);
    expect(s.capScale).toBeCloseTo(after.scale! * (1 + capGrowthRate(s.seed, second)), 9);
    expect(s.capGrowthSeason).toBe(second);
    expect(Object.values(s.teams)[0]!.cap.total).toBe(Math.round(after.total * (1 + capGrowthRate(s.seed, second)) * 10) / 10);
  }, 600_000);

  it("rolls a league that has already grown from where it stands, and a different league by its own rate", () => {
    const grown = leagueInPreseason(4244);
    grown.capScale = 1.3;
    grown.capGrowthSeason = grown.season - 1;
    for (const t of Object.values(grown.teams)) t.cap.total = Math.round(BASE_CAP_M * 1.3 * 10) / 10;
    const ended = rollOver(grown);
    const rate = capGrowthRate(grown.seed, ended);
    expect(grown.capScale).toBeCloseTo(1.3 * (1 + rate), 9);
    expect(Object.values(grown.teams)[0]!.cap.total).toBe(Math.round(Math.round(BASE_CAP_M * 1.3 * 10) / 10 * (1 + rate) * 10) / 10);
    expect(capGrowthRate(4244, ended), "league 4244 does not grow like league 4242").not.toBe(capGrowthRate(4242, ended));
  }, 600_000);
});
