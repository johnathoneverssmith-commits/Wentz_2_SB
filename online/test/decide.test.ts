import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { ensureDraftPicks, pickKey } from "@/state/draftPicks.ts";

import {
  decideContractMove,
  decideDraftPick,
  decideProposeTrade,
  decideRelease,
  decideRespondToTrade,
  decideSetDepth,
  decideSignFreeAgent,
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
});

const rosterOf = (code: string) =>
  Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent);

describe("signing a free agent", () => {
  /**
   * A free agent, and a roster with room for him.
   *
   * The pool holds real rosters now, and a real roster arrives at or over the
   * 53-man limit — so every one of these signings was refused for want of a
   * spot before it could exercise the thing under test. Clearing the seat is
   * part of the fixture, not part of the ruling.
   */
  function aFreeAgent() {
    const p = Object.values(state.players).find((x) => !x.retired && !x.free_agent)!;
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
    // make sure the signing team is under the limit with a seat to spare
    const mine = Object.values(state.players).filter(
      (x) => x.nfl_team === alice.teamCode && !x.retired && !x.free_agent,
    );
    for (const extra of mine.slice(52)) {
      extra.free_agent = true;
      extra.nfl_team = "FA";
      extra.contract = null;
    }
    return p;
  }

  it("goes through when there's room", () => {
    const p = aFreeAgent();
    state.teams[alice.teamCode]!.cap.total = 400;
    const out = decideSignFreeAgent(state, alice, p.id, {
      baseSalary: 5,
      signingBonus: 0,
      years: 2,
      guaranteed: 0,
    });
    expect(state.players[p.id]!.nfl_team).toBe(alice.teamCode);
    expect(out.events[0]!.kind).toBe("fa.signed");
  });

  it("is refused when the cap says no, with a reason a person can act on", () => {
    const p = aFreeAgent();
    state.teams[alice.teamCode]!.cap.total = state.teams[alice.teamCode]!.cap.used + 1;
    expect(() =>
      decideSignFreeAgent(state, alice, p.id, {
        baseSalary: 40,
        signingBonus: 0,
        years: 2,
        guaranteed: 0,
      }),
    ).toThrow(/cap space/i);
  });

  it("is refused once somebody else has signed him", () => {
    // this is the async case: two GMs want the same player a day apart, and
    // the second one's request arrives against a league where he's gone
    const p = aFreeAgent();
    state.teams[alice.teamCode]!.cap.total = 400;
    state.teams[bob.teamCode]!.cap.total = 400;
    decideSignFreeAgent(state, alice, p.id, {
      baseSalary: 5,
      signingBonus: 0,
      years: 2,
      guaranteed: 0,
    });
    expect(() =>
      decideSignFreeAgent(state, bob, p.id, {
        baseSalary: 9,
        signingBonus: 0,
        years: 2,
        guaranteed: 0,
      }),
    ).toThrow(/no longer a free agent/i);
  });
});

describe("proposing a trade", () => {
  it("moves nothing — that's what the second phase is for", () => {
    const mine = rosterOf(alice.teamCode)[0]!;
    const theirs = rosterOf(bob.teamCode)[0]!;
    decideProposeTrade(state, alice, "t1", bob.teamCode, [mine.id], [theirs.id]);
    expect(state.players[mine.id]!.nfl_team).toBe(alice.teamCode);
    expect(state.players[theirs.id]!.nfl_team).toBe(bob.teamCode);
    expect(state.trades[0]!.status).toBe("offered");
  });

  it("refuses to offer someone else's player", () => {
    const notMine = rosterOf(teamOf(3))[0]!;
    const theirs = rosterOf(bob.teamCode)[0]!;
    expect(() =>
      decideProposeTrade(state, alice, "t1", bob.teamCode, [notMine.id], [theirs.id]),
    ).toThrow(/only offer what you own/i);
  });

  it("refuses to ask for a player who isn't theirs", () => {
    const mine = rosterOf(alice.teamCode)[0]!;
    const thirdParty = rosterOf(teamOf(4))[0]!;
    expect(() =>
      decideProposeTrade(state, alice, "t1", bob.teamCode, [mine.id], [thirdParty.id]),
    ).toThrow(/only ask for/i);
  });

  it("refuses to offer a pick that has already been traded away", () => {
    const key = pickKey(state.season, 1, alice.teamCode);
    state.draftPicks[key]!.ownedBy = teamOf(5);
    const theirs = rosterOf(bob.teamCode)[0]!;
    expect(() =>
      decideProposeTrade(state, alice, "t1", bob.teamCode, [`pick:${key}`], [theirs.id]),
    ).toThrow(/only offer what you own/i);
  });

  it("won't let a GM trade with themselves", () => {
    expect(() => decideProposeTrade(state, alice, "t1", alice.teamCode, [], [])).toThrow(
      /with yourself/i,
    );
  });
});

describe("answering a trade", () => {
  function anOffer(): string {
    const mine = rosterOf(alice.teamCode).slice(-1)[0]!;
    const theirs = rosterOf(bob.teamCode).slice(-1)[0]!;
    decideProposeTrade(state, alice, "t1", bob.teamCode, [mine.id], [theirs.id]);
    return "t1";
  }

  it("moves both sides on acceptance", () => {
    const id = anOffer();
    const t = state.trades.find((x) => x.id === id)!;
    const gave = t.fromAssets[0]!.playerId!;
    const got = t.toAssets[0]!.playerId!;
    decideRespondToTrade(state, bob, id, true);
    expect(state.players[gave]!.nfl_team).toBe(bob.teamCode);
    expect(state.players[got]!.nfl_team).toBe(alice.teamCode);
  });

  it("can only be answered by the team it was offered to", () => {
    const id = anOffer();
    const carol: Actor = { ...alice, userId: "u3", teamCode: teamOf(2) };
    expect(() => decideRespondToTrade(state, carol, id, true)).toThrow(/isn't yours/i);
  });

  it("can't be answered twice", () => {
    const id = anOffer();
    decideRespondToTrade(state, bob, id, false);
    expect(() => decideRespondToTrade(state, bob, id, true)).toThrow(/already been answered/i);
  });

  it("is re-checked at acceptance, not just at proposal", () => {
    // the days-apart case: legal when offered, illegal by the time it's read
    const id = anOffer();
    state.teams[bob.teamCode]!.cap.total = 1; // they spent everything meanwhile
    expect(() => decideRespondToTrade(state, bob, id, true)).toThrow(/over the cap/i);
    const t = state.trades.find((x) => x.id === id)!;
    expect(t.status).toBe("offered"); // still open; nothing half-applied
  });

  it("declining leaves both rosters exactly as they were", () => {
    const id = anOffer();
    const t = state.trades.find((x) => x.id === id)!;
    const gave = t.fromAssets[0]!.playerId!;
    decideRespondToTrade(state, bob, id, false);
    expect(state.players[gave]!.nfl_team).toBe(alice.teamCode);
    expect(state.trades.find((x) => x.id === id)!.status).toBe("rejected");
  });
});

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
    expect(() => decideDraftPick(state, bob, prospect.id)).toThrow(/already gone/i);
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
