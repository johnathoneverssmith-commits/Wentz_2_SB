import { beforeEach, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";

import { decideDraftPick, type Actor } from "../src/decide.js";

/**
 * `decideDraftPick`'s own stage transition, at the `decide.ts` layer.
 *
 * `draft-completion.test.ts` and `draftThresholdMet`/`completeDraft`'s own
 * tests already cover the state logic — that the threshold fires once every
 * human is past it, and that the board fills legally when it does. None of
 * them go through `decideDraftPick` itself, so none of them would have caught
 * a bug like the one just fixed in `decideFreeAgencyTurn`: the completion
 * check was right, but the *stage transition* it gated was hardcoded to the
 * wrong stage name for one of the two stages that share this action. This
 * file is the equivalent coverage for the draft, which has the same shape —
 * one action, two stages (`fantasyDraft` and `offseasonDraft`) — but reads
 * the actual `state.stage` rather than a literal, so it is not expected to
 * have the same bug; these tests exist to keep it that way.
 */
let state: LeagueState;
let alice: Actor;
let bob: Actor;

beforeEach(() => {
  state = createLeague(2468, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  recomputeTeamRatings(state);
  const teams = Object.keys(state.teams);
  alice = { userId: "u1", leagueId: "l", teamCode: teams[0]!, gmId: "gm_you" };
  bob = { userId: "u2", leagueId: "l", teamCode: teams[1]!, gmId: "gm_1" };
  state.gms[0]!.teamCode = alice.teamCode;
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = bob.teamCode;
  state.gms[1]!.isHuman = true;
});

/** A two-pick fantasy draft: threshold 1, one pick each, nothing left over. */
function twoPickFantasyDraft(): void {
  state.stage = "fantasyDraft";
  state.config = { ...state.config, draftSimulateAfterPicks: 1 };
  state.draft = {
    mode: "fantasy",
    year: state.season,
    order: "linear",
    pickOrder: [alice.teamCode, bob.teamCode],
    currentPickIndex: 0,
    results: [],
    targetsByGm: {},
  };
}

describe("decideDraftPick — stage transition on completion", () => {
  it("moves fantasyDraft to fantasyDraftSummary the instant the threshold closes the board", () => {
    twoPickFantasyDraft();
    const first = Object.values(state.players).find((p) => !p.retired)!;
    decideDraftPick(state, alice, first.id);
    expect(state.stage).toBe("fantasyDraft"); // one human still short

    const second = Object.values(state.players).find(
      (p) => !p.retired && p.id !== first.id,
    )!;
    decideDraftPick(state, bob, second.id);
    expect(state.stage).toBe("fantasyDraftSummary");
    expect(state.draft!.currentPickIndex).toBe(state.draft!.pickOrder.length);
  });

  it("moves offseasonDraft to offseasonDraftSummary the same way", () => {
    state.stage = "offseasonDraft";
    state.draft = {
      mode: "rookie",
      year: state.season,
      order: "linear",
      // rookie mode's threshold is "every team has picked once" — shrinking
      // pickOrder to match the two teams under test, rather than the full
      // league, is what lets a two-team fixture actually reach it
      pickOrder: [alice.teamCode, bob.teamCode],
      currentPickIndex: 0,
      results: [],
      targetsByGm: {},
    };
    const savedTeams = state.teams;
    state.teams = { [alice.teamCode]: savedTeams[alice.teamCode]!, [bob.teamCode]: savedTeams[bob.teamCode]! };

    decideDraftPick(state, alice, state.draftClass[0]!.id);
    expect(state.stage).toBe("offseasonDraft");
    decideDraftPick(state, bob, state.draftClass[1]!.id);
    expect(state.stage).toBe("offseasonDraftSummary");
  });

  it("refuses a further pick after the board has closed rather than redrafting", () => {
    twoPickFantasyDraft();
    const [first, second] = Object.values(state.players).filter((p) => !p.retired);
    decideDraftPick(state, alice, first!.id);
    decideDraftPick(state, bob, second!.id);
    expect(state.stage).toBe("fantasyDraftSummary");

    const third = Object.values(state.players).find(
      (p) => !p.retired && p.id !== first!.id && p.id !== second!.id,
    )!;
    const before = state.draft!.results.length;
    expect(() => decideDraftPick(state, alice, third.id)).toThrow();
    // the throw left the board exactly as the completion left it
    expect(state.draft!.results.length).toBe(before);
    expect(state.stage).toBe("fantasyDraftSummary");
  });
});
