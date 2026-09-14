import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { autopilotAbsent, advanceStage, clearReadinessOnline, deadlineFor, waitingOn } from "../src/phases.js";

/**
 * Async play's central problem: one GM stops logging in, and seven other
 * people can't play. Everything here is about that — the league moves on
 * with or without you, and "without you" means the same AI that runs the
 * unclaimed teams takes your turn rather than the league sitting still.
 */
let state: LeagueState;

beforeEach(() => {
  state = createLeague(202, DEFAULT_CONFIG);
  fillRosterGaps(state);
  const codes = Object.keys(state.teams);
  state.gms.forEach((g, i) => {
    g.teamCode = codes[i]!;
    g.isHuman = true;
  });
  state.stage = "offseasonDepthChart";
  clearReadinessOnline(state);
});

describe("readiness, online", () => {
  it("starts everybody not-ready, unlike the hot seat", () => {
    // single-player marks everyone but the viewer ready, which would advance
    // a league of eight the instant one person clicked
    expect(waitingOn(state)).toHaveLength(state.gms.length);
  });

  it("doesn't wait on a team nobody owns", () => {
    state.gms[1]!.isHuman = false;
    clearReadinessOnline(state);
    expect(waitingOn(state)).not.toContain(state.gms[1]!.teamCode);
  });

  it("doesn't wait on a GM slot with no team", () => {
    state.gms[2]!.teamCode = "";
    clearReadinessOnline(state);
    expect(waitingOn(state)).toHaveLength(state.gms.length - 1);
  });
});

describe("when the clock runs out", () => {
  it("marks the absent ready rather than leaving the league stuck", () => {
    state.readiness[state.gms[0]!.id] = true;
    const played = autopilotAbsent(state);
    expect(played).toContain(state.gms[1]!.teamCode);
    expect(waitingOn(state)).toHaveLength(0);
  });

  it("only takes the pick of the team actually on the clock", () => {
    // in a draft the other GMs aren't holding anyone up; only the one whose
    // turn it is, so only their pick gets made for them
    state.stage = "offseasonDraft";
    state.draft = {
      mode: "rookie",
      year: state.season,
      order: "linear",
      pickOrder: [state.gms[0]!.teamCode, state.gms[1]!.teamCode],
      currentPickIndex: 0,
      results: [],
      targetsByGm: {},
    };
    const played = autopilotAbsent(state);
    expect(played).toEqual([state.gms[0]!.teamCode]);
    expect(state.draft.currentPickIndex).toBe(1);
    expect(state.draft.results).toHaveLength(1);
  });

  it("leaves an AI team's pick to the draft itself", () => {
    state.stage = "offseasonDraft";
    state.gms[0]!.isHuman = false;
    state.draft = {
      mode: "rookie",
      year: state.season,
      order: "linear",
      pickOrder: [state.gms[0]!.teamCode],
      currentPickIndex: 0,
      results: [],
      targetsByGm: {},
    };
    expect(autopilotAbsent(state)).toEqual([]);
  });
});

describe("advancing", () => {
  it("uses the same transition table the single-player game does", () => {
    for (const g of state.gms) state.readiness[g.id] = true;
    const before = state.stage;
    expect(advanceStage(state).moved).toBe(true);
    expect(state.stage).not.toBe(before);
  });

  it("resets everyone to not-ready on the far side", () => {
    for (const g of state.gms) state.readiness[g.id] = true;
    advanceStage(state);
    expect(waitingOn(state).length).toBeGreaterThan(0);
  });

  it("won't step a game week — those advance by being played", () => {
    state.stage = "regularSeason";
    for (const g of state.gms) state.readiness[g.id] = true;
    expect(advanceStage(state).moved).toBe(false);
  });
});

describe("deadlines", () => {
  const league = { phaseTimeoutHours: 48, pickTimeoutHours: 12 };

  it("gives an ordinary phase the league's phase timeout", () => {
    state.stage = "offseasonFreeAgency";
    const ms = deadlineFor(state, league).getTime() - Date.now();
    expect(ms / 3_600_000).toBeCloseTo(48, 0);
  });

  it("puts the draft on the shorter per-pick clock", () => {
    // one pick shouldn't get two days; the whole room is waiting on it
    state.stage = "offseasonDraft";
    const ms = deadlineFor(state, league).getTime() - Date.now();
    expect(ms / 3_600_000).toBeCloseTo(12, 0);
  });
});
