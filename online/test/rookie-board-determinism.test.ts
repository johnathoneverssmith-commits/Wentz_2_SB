import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { beginDraft, bestAvailable, planAutopicks, runAiPicks } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";

import { decideDraftPick, type Actor } from "../src/decide.js";

/**
 * The rookie draft the way the server runs it: CPU picks from `runAiPicks`, each person's pick through
 * `decideDraftPick`, a pick on the clock's behalf from `planAutopicks`, and the league state going out to storage and
 * coming back between requests. None of it may depend on anything but the league's own data: the same league must draft
 * the same board whichever process computes it and however often it is saved and reloaded, and a person's own pick is
 * theirs even when the suggestion was something else. The CPU reads prospects from public data only (`draftBoard.ts`).
 */
function league(): { state: LeagueState; alice: Actor; bob: Actor } {
  const state = createLeague(3131, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  recomputeTeamRatings(state);
  const teams = Object.keys(state.teams);
  const alice: Actor = { userId: "u1", leagueId: "l", teamCode: teams[0]!, gmId: "gm_you" };
  const bob: Actor = { userId: "u2", leagueId: "l", teamCode: teams[1]!, gmId: "gm_1" };
  state.gms[0]!.teamCode = alice.teamCode;
  state.gms[0]!.isHuman = true;
  state.gms[1]!.teamCode = bob.teamCode;
  state.gms[1]!.isHuman = true;
  state.stage = "offseasonDraft";
  return { state, alice, bob };
}

/** Both people take the suggestion every time; `reload` sends the league through JSON between requests. */
function playDraft(reload: boolean, scramble = false): string[] {
  let { state, alice, bob } = league();
  if (scramble) state.draftClass = state.draftClass.map((p, i) => ({ ...p, trueOverall: 99 - ((i * 11) % 57) }));
  beginDraft(state, "rookie");
  runAiPicks(state);
  let guard = 0;
  while (state.draft && state.draft.currentPickIndex < state.draft.pickOrder.length && guard++ < 300) {
    const onClock = state.draft.pickOrder[state.draft.currentPickIndex]!;
    const actor = onClock === alice.teamCode ? alice : onClock === bob.teamCode ? bob : null;
    if (!actor) throw new Error(`a CPU team (${onClock}) was left on the clock`);
    decideDraftPick(state, actor, bestAvailable(state)!);
    if (reload) state = JSON.parse(JSON.stringify(state)) as LeagueState;
  }
  return state.draft!.results.map((r) => r.selectedId!);
}

describe("the rookie draft on the server path", () => {
  const baseline = playDraft(false);

  it("completes with every pick distinct", () => {
    expect(baseline).toHaveLength(224);
    expect(new Set(baseline).size).toBe(224);
  });

  it("is deterministic: the same league drafts the same board again", () => {
    expect(playDraft(false)).toEqual(baseline);
  });

  it("does not depend on being saved and reloaded between requests", () => {
    expect(playDraft(true)).toEqual(baseline);
  });

  it("never uses a prospect's hidden rating: scrambling every true rating gives the same draft", () => {
    expect(playDraft(false, true)).toEqual(baseline);
  });

  it("makes the pick on the clock's behalf the same as the suggestion", () => {
    const { state } = league();
    beginDraft(state, "rookie");
    expect(planAutopicks(state)[0]).toBe(bestAvailable(state));
  });

  it("never overrides a person's own pick: what they select is what they get, whatever was suggested", () => {
    const { state, alice } = league();
    beginDraft(state, "rookie");
    // run the CPU up to the first person on the clock, then pick the board's last prospect, not the suggestion
    runAiPicks(state);
    const onClock = state.draft!.pickOrder[state.draft!.currentPickIndex]!;
    const actor = onClock === alice.teamCode ? alice : { ...alice, teamCode: onClock, gmId: state.gms.find((g) => g.teamCode === onClock)!.id };
    const suggested = bestAvailable(state)!;
    const chosen = state.draftClass.filter((p) => p.id !== suggested).at(-1)!.id;
    decideDraftPick(state, actor, chosen);
    expect(state.draft!.results.find((r) => r.teamCode === onClock)!.selectedId).toBe(chosen);
  });
});
