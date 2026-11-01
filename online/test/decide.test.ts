import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { ensureDraftPicks } from "@/state/draftPicks.ts";

import {
  decideContractMove,
  decideDraftPick,
  decideRelease,
  decideSetDepth,
  type Actor,
} from "../src/decide.js";

/**
 * The rulings, tested without a database.
 *
 * These are the decisions that lose a league if they're wrong: a trade that
 * shouldn't have gone through can't be taken back the way a dropped
 * connection can. Every one of them runs against the state as it is at the
 * moment of the call, which is the property that makes a server
 * authoritative rather than merely persistent.
 */

let state: LeagueState;
let alice: Actor;
let bob: Actor;

function teamOf(i: number): string {
  return Object.keys(state.teams)[i]!;
}

beforeEach(() => {
  state = createLeague(101, DEFAULT_CONFIG);
  fillRosterGaps(state);
  ensureDraftPicks(state, state.season);
  recomputeTeamRatings(state);
  alice = { userId: "u1", leagueId: "l", teamCode: teamOf(0), gmId: "gm_you" };
  bob = { userId: "u2", leagueId: "l", teamCode: teamOf(1), gmId: "gm_1" };
  state.gms[0]!.teamCode = alice.teamCode;
  state.gms[1]!.teamCode = bob.teamCode;
  // Two people have claimed these seats, which is what `claimTeam` records.
  // The solo seed marks the rival GM slots non-human — they are AI opponents
  // nobody is going to take turns for — and `leagues.ts` clears the flag on
  // every slot at creation anyway, so an online fixture has to set it rather
  // than inherit it. Without this the draft's `runAiPicks` treats bob's team
  // as a CPU and picks for him the moment alice is done.
  state.gms[0]!.isHuman = true;
  state.gms[1]!.isHuman = true;
});

const rosterOf = (code: string) =>
  Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent);

describe("the draft", () => {
  beforeEach(() => {
    state.stage = "offseasonDraft";
    state.draft = {
      mode: "rookie",
      year: state.season,
      order: "linear",
      pickOrder: [alice.teamCode, bob.teamCode],
      currentPickIndex: 0,
      results: [],
      targetsByGm: {},
    };
  });

  it("lets the team on the clock pick", () => {
    const prospect = state.draftClass[0]!;
    const out = decideDraftPick(state, alice, prospect.id);
    expect(state.draft!.currentPickIndex).toBe(1);
    expect(out.events[0]!.summary).toContain(prospect.name);
  });

  it("refuses a team that isn't on the clock, and says who is", () => {
    expect(() => decideDraftPick(state, bob, state.draftClass[0]!.id)).toThrow(/on the clock/i);
  });

  it("refuses a prospect who has already gone", () => {
    const prospect = state.draftClass[0]!;
    decideDraftPick(state, alice, prospect.id);
    expect(() => decideDraftPick(state, bob, prospect.id)).toThrow(/already drafted/i);
  });
});

describe("roster moves", () => {
  it("releases only your own player", () => {
    const theirs = rosterOf(bob.teamCode)[0]!;
    expect(() => decideRelease(state, alice, theirs.id)).toThrow(/isn't yours/i);
  });

  it("ignores other teams' players in a depth chart", () => {
    const theirs = rosterOf(bob.teamCode).find((p) => p.position === "QB")!;
    const mine = rosterOf(alice.teamCode).find((p) => p.position === "QB")!;
    decideSetDepth(state, alice, "QB", [theirs.id, mine.id]);
    expect(state.depthChart[alice.teamCode]!.QB).toEqual([mine.id]);
  });

  it("won't restructure a contract that isn't yours", () => {
    const theirs = rosterOf(bob.teamCode)[0]!;
    expect(() => decideContractMove(state, alice, theirs.id, { kind: "restructure" })).toThrow(
      /isn't yours/i,
    );
  });
});
