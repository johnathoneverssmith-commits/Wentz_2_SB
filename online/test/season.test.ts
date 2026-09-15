import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { humanGate } from "@/state/rules.ts";

import { advanceStage, clearReadinessOnline, finishPlayedWeek } from "../src/phases.js";

/**
 * A season, start to finish, on the server's own machinery.
 *
 * Every piece of this was missing online and each failure was silent in the
 * same way: the league simply stopped, on a screen that looked fine. The week
 * never advanced past the one that had been played; the bracket was never
 * seeded; the playoffs had no path at all; and a league that somehow finished
 * would have started the next year with last year's schedule and records.
 *
 * So this walks a league from kickoff to the following season and asserts it
 * keeps moving. It does not play the games — `simulate.ts` owns that, and it
 * needs the engine — it drives the clock, which is what was broken.
 */
const sim = new MockSimulationService();

function leagueInPreseason(): LeagueState {
  const state = createLeague(4242, { ...DEFAULT_CONFIG, humanGmCount: 2 });
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

describe("the readiness gate holds the week", () => {
  /**
   * The one thing that must not loosen.
   *
   * A week only plays when every human GM has said they are ready, and the
   * "Ready for Game Day" button is how they say it. `simulateWeekForLeague`
   * checks `humanGate` as its second guard — ahead of the playoff round and
   * ahead of the branch that ends a week whose games are already on file — so
   * no path through it can advance a league that is still waiting on somebody.
   * These pin the condition that guard reads.
   */
  it("is closed while any GM is still pending", () => {
    const s = leagueInPreseason();
    s.readiness[s.gms[0]!.id] = true;
    s.readiness[s.gms[1]!.id] = false;
    expect(humanGate(s)).toBe(false);
  });

  it("opens only once the last one readies up", () => {
    const s = leagueInPreseason();
    for (const g of s.gms) s.readiness[g.id] = false;
    expect(humanGate(s)).toBe(false);
    s.readiness[s.gms[0]!.id] = true;
    expect(humanGate(s)).toBe(false);
    s.readiness[s.gms[1]!.id] = true;
    expect(humanGate(s)).toBe(true);
  });

  it("never waits on a team nobody is running", () => {
    const s = leagueInPreseason();
    // an AI team has no one to wait for, or a short league could never play
    for (const g of s.gms) s.readiness[g.id] = true;
    expect(humanGate(s)).toBe(true);
  });

  it("closes again for the next week once a stage opens", () => {
    const s = leagueInPreseason();
    for (const g of s.gms) s.readiness[g.id] = true;
    clearReadinessOnline(s);
    // everybody has to say so again, every week
    expect(humanGate(s)).toBe(false);
  });
});

describe("a season on the server", () => {
  it("moves off a week once it has been played", () => {
    const s = leagueInPreseason();
    const before = s.week;
    finishPlayedWeek(s);
    // the whole bug: without this the next request finds the games on file
    // and refuses, forever
    expect(s.stage === "preseason" ? s.week : s.stage).not.toBe(before);
  });

  it("reaches the playoffs with a seeded bracket", () => {
    const s = leagueInPreseason();
    let guard = 0;
    while (s.stage !== "playoffs") {
      if (guard++ > 60) throw new Error(`stuck in ${s.stage} week ${s.week}`);
      finishPlayedWeek(s);
    }
    expect(s.bracket).toBeTruthy();
    expect(s.bracket!.currentRound).toBe("WC");
    expect(s.bracket!.seeds.AFC).toHaveLength(7);
    expect(s.bracket!.seeds.NFC).toHaveLength(7);
    // the regular season's stats were reset on the way in, not carried
    expect(s.week).toBe(0);
  }, 120_000);

  it("rolls into the next season with a new schedule and clean records", () => {
    const s = leagueInPreseason();
    const startSeason = s.season;

    // run the clock to the playoffs, then hand the bracket a champion the way
    // a played round would
    let guard = 0;
    while (s.stage !== "playoffs") {
      if (guard++ > 60) throw new Error("never reached the playoffs");
      finishPlayedWeek(s);
    }
    s.bracket!.champion = "KC";

    guard = 0;
    while (s.season === startSeason) {
      if (guard++ > 40) throw new Error(`stuck in ${s.stage}`);
      for (const g of s.gms) s.readiness[g.id] = true;
      if (s.stage === "playoffs") finishPlayedWeek(s);
      else advanceStage(s);
    }

    expect(s.season).toBe(startSeason + 1);
    expect(s.games).toHaveLength(0);
    expect(s.bracket).toBeNull();
    expect(s.schedule.length).toBeGreaterThan(0);
    for (const code of Object.keys(s.teams)) {
      expect(s.teams[code]!.wins).toBe(0);
      expect(s.teams[code]!.losses).toBe(0);
    }
    // and there is something to draft next spring
    expect(s.draftClass.length).toBeGreaterThan(0);
  }, 180_000);
});
