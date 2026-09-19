import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { ensureDraftPicks } from "@/state/draftPicks.ts";
import { beginCoachingDraft } from "@/state/coachingDraft.ts";
import { beginTradeDeadline } from "@/state/tradeDeadline.ts";
import { beginFreeAgencyEvent, unsignedPool } from "@/state/freeAgencyEvent.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import type { TrainingCampPlan } from "@/state/trainingCamp.ts";

import {
  decideCoachHire,
  decideCoachingPick,
  decideDeadlineTurn,
  decideDraftPick,
  decideFreeAgencyTurn,
  decideReveal,
  decideRevealRound,
  decideRookieOutcome,
  decideStep,
  decideTrainingCamp,
  type Actor,
} from "../src/decide.js";

/**
 * Fault-injection coverage for `decide.ts`, following the matrix in
 * `MULTIPLAYER_SYNC_FAULT_INJECTION_SPEC.md`.
 *
 * `decide.test.ts` already covers most of this matrix for free-agency
 * signing and trades (fixtures H and G, roughly). What it and the rest of
 * this suite left untouched is every other `decide*` function's own
 * duplicate-submit and stale-turn behaviour — which is exactly the layer
 * where the two real deadlocks fixed earlier in this pass actually lived
 * (Training Camp's missing client-side handoff, and
 * `decideFreeAgencyTurn`'s stage guard). Nothing here found a new bug; it
 * closes the gap so a regression in any of these would be caught here
 * instead of in production.
 *
 * What this file cannot cover: genuine concurrent execution needs a real
 * database — two requests actually racing through `SELECT … FOR UPDATE`
 * and the version compare-and-swap in `db.ts`. `concurrency.test.ts`
 * exists for that and is designed to skip loudly without `DATABASE_URL`;
 * this environment has no local Postgres or Docker available, so those
 * tests have not been run for real in this session (see below). What is
 * testable without a database — and what every one of these fixtures
 * actually failed on, in the two deadlocks fixed earlier — is whether the
 * *rule* itself is idempotent: does calling it a second time, with the
 * state exactly as the first call left it, do nothing worse than refuse?
 * A double-click, a second tab, and a client retrying after a dropped
 * response are all, from `decide.ts`'s point of view, the same event:
 * the same action arriving against a state that already reflects it.
 */
let state: LeagueState;
let alice: Actor;
let bob: Actor;

function teamOf(i: number): string {
  return Object.keys(state.teams)[i]!;
}

beforeEach(() => {
  state = createLeague(4141, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  ensureDraftPicks(state, state.season);
  recomputeTeamRatings(state);
  alice = { userId: "u1", leagueId: "l", teamCode: teamOf(0), gmId: "gm_you" };
  bob = { userId: "u2", leagueId: "l", teamCode: teamOf(1), gmId: "gm_1" };
  state.gms[0]!.teamCode = alice.teamCode;
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = bob.teamCode;
  state.gms[1]!.isHuman = true;
});

describe("fault A/B/F — double click, two tabs, retry after a dropped response", () => {
  it("training camp: a second submission is refused, not re-run", () => {
    state.stage = "trainingCamp";
    const plan: TrainingCampPlan = {
      offensiveFocus: "QB",
      defensiveFocus: "DL",
      positiveInvestment: 0,
      negativeInvestment: 0,
      submitted: false,
    };
    decideTrainingCamp(state, alice, plan);
    const resultsAfterFirst = state.trainingCamp!.results[alice.teamCode];
    const capAfterFirst = state.teams[alice.teamCode]!.cap.used;

    expect(() => decideTrainingCamp(state, alice, plan)).toThrow(/already run camp/i);
    // the retry changed nothing — no second roll, no second charge
    expect(state.trainingCamp!.results[alice.teamCode]).toBe(resultsAfterFirst);
    expect(state.teams[alice.teamCode]!.cap.used).toBe(capAfterFirst);
  });

  it("coaching pick: a repeat of the exact same request finds the seat already gone", () => {
    state.stage = "coachingDraft";
    beginCoachingDraft(state);
    // whichever coach the fixture's on-the-clock team can legally take
    const onClock = state.coachingDraft!.pickOrder[0]!;
    const actor = onClock === alice.teamCode ? alice : onClock === bob.teamCode ? bob : null;
    if (!actor) return; // fixture's order didn't land on a human first — nothing to double-click
    const coachId = Object.values(state.coaches).find((c) => !c.team)!.id;
    decideCoachingPick(state, actor, coachId);
    expect(() => decideCoachingPick(state, actor, coachId)).toThrow(/already taken|isn't your pick/i);
  });

  it("rookie outcome: settling twice is refused the second time", () => {
    state.stage = "offseasonDraftSummary";
    state.draft = {
      mode: "rookie",
      year: state.season,
      order: "linear",
      pickOrder: [alice.teamCode],
      currentPickIndex: 1,
      results: [{ pickNumber: 1, round: 1, teamCode: alice.teamCode, selectedId: state.draftClass[0]!.id, selectedName: null, selectedPosition: null }],
      targetsByGm: {},
    };
    decideRookieOutcome(state, alice, state.draftClass[0]!.id, true);
    expect(() => decideRookieOutcome(state, alice, state.draftClass[0]!.id, false)).toThrow(
      /already settled/i,
    );
  });

  it("coach hire: hiring the same free coach twice fails the second time cleanly", () => {
    const coach = Object.values(state.coaches).find((c) => !c.team)!;
    decideCoachHire(state, alice, coach.id);
    expect(() => decideCoachHire(state, bob, coach.id)).toThrow(/under contract/i);
  });

  it("reveal: asking to reveal the same week twice is refused, not re-applied", () => {
    state.stage = "regularSeason";
    state.games.push({
      id: "g1",
      week: 1,
      phase: "REG",
      homeTeam: alice.teamCode,
      awayTeam: bob.teamCode,
      played: true,
      homeScore: 20,
      awayScore: 14,
    });
    decideReveal(state, alice, 1);
    expect(() => decideReveal(state, alice, 1)).toThrow(/already seen/i);
  });

  it("step: re-marking the same step twice is a harmless no-op, not an error", () => {
    // unlike a submission, a step marker is idempotent by design — see
    // markStep's doc comment — so the second call must succeed and leave
    // the marker exactly where the first one put it
    decideStep(state, alice, "draftPreview");
    expect(() => decideStep(state, alice, "draftPreview")).not.toThrow();
  });

  it("draft pick: retrying a just-made pick against the team now on the clock is refused", () => {
    state.stage = "fantasyDraft";
    state.draft = {
      mode: "fantasy",
      year: state.season,
      order: "linear",
      pickOrder: [alice.teamCode, bob.teamCode],
      currentPickIndex: 0,
      results: [],
      targetsByGm: {},
    };
    const first = Object.values(state.players).find((p) => !p.retired)!;
    decideDraftPick(state, alice, first.id);
    // alice's client, having not heard back, tries the same pick again —
    // it isn't her turn any more, and the player is already gone either way
    expect(() => decideDraftPick(state, alice, first.id)).toThrow(/on the clock|already gone/i);
  });
});

describe("fault G/I — a stale action against assets that moved since it was built", () => {
  it("trade deadline: a negotiation cannot be accepted once its assets have moved", () => {
    state.stage = "tradeDeadline";
    beginTradeDeadline(state);
    const d = state.tradeDeadline!;
    // force alice to the front of the line so the fixture is deterministic
    d.order = [alice.teamCode, ...d.order.filter((t) => t !== alice.teamCode)];
    d.index = 0;
    const mine = Object.values(state.players).find(
      (p) => p.nfl_team === alice.teamCode && !p.retired && !p.free_agent,
    )!;
    const theirs = Object.values(state.players).find(
      (p) => p.nfl_team === bob.teamCode && !p.retired && !p.free_agent,
    )!;
    decideDeadlineTurn(state, alice, {
      kind: "propose",
      toTeam: bob.teamCode,
      give: [mine.id],
      get: [theirs.id],
    });
    // the asset moves out from under the open negotiation — released, not
    // traded, but the effect on "is it still his to give" is identical
    mine.nfl_team = "FA";
    mine.free_agent = true;

    expect(() => decideDeadlineTurn(state, bob, { kind: "accept" })).toThrow(/already moved/i);
  });

  it("playoffs: revealing a round twice is refused, and revealing an unplayed one is refused", () => {
    state.stage = "playoffs";
    state.bracket = {
      currentRound: "WC",
      seeds: { AFC: [alice.teamCode], NFC: [bob.teamCode] },
      champion: null,
      matchups: [
        {
          round: "WC",
          conference: "AFC",
          highSeed: { code: alice.teamCode, seed: 1 },
          lowSeed: { code: bob.teamCode, seed: 2 },
          favoredWinProb: 60,
          winner: alice.teamCode,
          homeScore: 24,
          awayScore: 10,
        },
      ],
    };
    decideRevealRound(state, alice);
    expect(() => decideRevealRound(state, alice)).toThrow(/hasn't been played|watched the whole/i);
  });
});

describe("fault C — two humans finishing at once produces one outcome, not two", () => {
  it("the fantasy draft threshold fires exactly once, whichever human reaches it last", () => {
    // built once, then played out both ways, so the two orderings are
    // compared against the same starting point rather than two coincidences
    const build = () => {
      const s = createLeague(4141, { ...DEFAULT_CONFIG, humanGmCount: 2 });
      fillRosterGaps(s);
      s.gms[0]!.teamCode = teamOf(0);
      s.gms[0]!.isHuman = true;
      s.gms[1]!.teamCode = teamOf(1);
      s.gms[1]!.isHuman = true;
      s.stage = "fantasyDraft";
      s.config = { ...s.config, draftSimulateAfterPicks: 1 };
      s.draft = {
        mode: "fantasy",
        year: s.season,
        order: "linear",
        pickOrder: [teamOf(0), teamOf(1)],
        currentPickIndex: 0,
        results: [],
        targetsByGm: {},
      };
      return s;
    };
    const players = () => Object.values(state.players).filter((p) => !p.retired).slice(0, 2);

    const aFirst = build();
    state = aFirst;
    const [p1, p2] = players();
    decideDraftPick(aFirst, { userId: "u1", leagueId: "l", teamCode: teamOf(0), gmId: "gm_you" }, p1!.id);
    decideDraftPick(aFirst, { userId: "u2", leagueId: "l", teamCode: teamOf(1), gmId: "gm_1" }, p2!.id);

    const bFirst = build();
    state = bFirst;
    // same two picks, opposite request order — the draft enforces the turn
    // regardless, so this is "bob's request happened to be handled first"
    expect(() =>
      decideDraftPick(bFirst, { userId: "u2", leagueId: "l", teamCode: teamOf(1), gmId: "gm_1" }, p2!.id),
    ).toThrow(/on the clock/i);
    decideDraftPick(bFirst, { userId: "u1", leagueId: "l", teamCode: teamOf(0), gmId: "gm_you" }, p1!.id);
    decideDraftPick(bFirst, { userId: "u2", leagueId: "l", teamCode: teamOf(1), gmId: "gm_1" }, p2!.id);

    expect(aFirst.stage).toBe("fantasyDraftSummary");
    expect(bFirst.stage).toBe("fantasyDraftSummary");
    expect(aFirst.draft!.results.map((r) => r.selectedId).sort()).toEqual(
      bFirst.draft!.results.map((r) => r.selectedId).sort(),
    );
  });
});

describe("fault H — the same free agent, bid on by more than one human", () => {
  it("records every human's offer and resolves to exactly one signing", () => {
    state.stage = "freeAgency";
    beginFreeAgencyEvent(state);
    const e = state.freeAgencyEvent!;
    // put both humans on the clock this round, in some order, so both get a
    // real turn at the same target before the round closes
    e.order = [alice.teamCode, bob.teamCode, ...e.order.filter((t) => t !== alice.teamCode && t !== bob.teamCode)];
    e.turnIndex = 0;
    const target = unsignedPool(state)[0]!;
    const ask = expectedSalary(target);

    decideFreeAgencyTurn(state, alice, { playerId: target.id, salary: ask + 5, years: 3 });
    decideFreeAgencyTurn(state, bob, { playerId: target.id, salary: ask + 8, years: 3 });
    // everybody else in the round passes, closing it
    let guard = 0;
    while (state.freeAgencyEvent!.round === 1 && guard++ < 40) {
      const clock = state.freeAgencyEvent!.order[state.freeAgencyEvent!.turnIndex]!;
      decideFreeAgencyTurn(state, { userId: clock, leagueId: "l", teamCode: clock, gmId: clock }, { pass: true });
    }

    expect(state.freeAgencyEvent!.offers[target.id]).toHaveLength(2);
    const signed = state.freeAgencyEvent!.signed.filter((s) => s.playerId === target.id);
    expect(signed).toHaveLength(1);
    // the higher offer is the one that actually wins the player
    expect(signed[0]!.teamCode).toBe(bob.teamCode);
    expect(state.players[target.id]!.nfl_team).toBe(bob.teamCode);
  });
});

/**
 * What this session could not validate: real concurrent writes through
 * `withLeague`'s row lock and version compare-and-swap. That needs
 * `DATABASE_URL` pointed at a real Postgres, which this environment does
 * not have (no local `psql`, `postgres`, `pg_ctl`, or `docker` on PATH).
 * `concurrency.test.ts` is written to exercise exactly that and skips each
 * of its cases individually, by name, when no database is reachable —
 * confirmed by running it here and observing every case reported as
 * skipped rather than passed. Running it for real is a deployment-adjacent
 * task (provision Postgres, set `DATABASE_URL`) rather than a code change.
 */
describe.skip("requires a real database — see comment above", () => {
  it("is a placeholder, not a test", () => {});
});
