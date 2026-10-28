import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * The CPU's contract terms (B2b, `state/contractValue.ts`) through the server's own season: the same league run twice, once
 * as it is and once written out and read back the way the league server keeps it, must end with the same contracts on every
 * player. The evaluator reads the cap, the window and what each team owes, so a field that does not survive a save, or an
 * order that depends on one, would show here and not in a unit test.
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

/** Play the clock to the playoffs, crown a champion, and run the stage machine through the offseason to the next preseason. */
function throughOffseason(s: LeagueState): void {
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
  guard = 0;
  while ((s.stage as string) !== "preseason" && guard++ < 60) {
    for (const g of s.gms) s.readiness[g.id] = true;
    advanceStage(s);
  }
}

const contracts = (s: LeagueState) =>
  Object.values(s.players)
    .filter((p) => !p.retired)
    .map((p) => [p.id, p.nfl_team, p.contract?.years_remaining ?? 0, p.contract?.cap_hit_by_year.join(",") ?? ""])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe("CPU contract terms through the server's offseason", () => {
  it("come out the same for a league and its saved-and-reloaded copy", () => {
    const direct = leagueInPreseason(4301);
    const reloaded = JSON.parse(JSON.stringify(direct)) as LeagueState;
    throughOffseason(direct);
    throughOffseason(reloaded);
    expect(contracts(reloaded)).toEqual(contracts(direct));
    // and the offseason did sign and extend people, so the comparison is not of two untouched rosters
    const longDeals = Object.values(direct.players).filter((p) => !p.retired && p.contract && p.contract.years_remaining >= 3);
    expect(longDeals.length).toBeGreaterThan(100);
  }, 900_000);
});
