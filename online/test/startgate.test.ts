import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { humanGate, openSlots, rosterGate } from "@/state/rules.ts";

import { advanceStage, clearReadinessOnline, heldBy } from "../src/phases.js";

/**
 * The rule that stops one person starting a league by themselves.
 *
 * No database needed: this is a ruling about a state, which is where it
 * belongs. The failure it guards is specific and unrecoverable — a league
 * that falls into the fantasy draft with one human in it has already drafted
 * by the time anybody else arrives, and there is no putting that back.
 */
function onlineLeague(slots: number): LeagueState {
  const state = createLeague(11, { ...DEFAULT_CONFIG, humanGmCount: slots });
  // the shape `createOnlineLeague` produces: every seat empty, nobody human
  for (const gm of state.gms) {
    gm.teamCode = "";
    gm.isHuman = false;
  }
  for (const code of Object.keys(state.teams)) {
    state.teams[code]!.controlledBy = { kind: "ai" };
  }
  state.stage = "setup";
  clearReadinessOnline(state);
  return state;
}

/** What `claimTeam` does to the document. */
function claim(state: LeagueState, gmIndex: number, teamCode: string): void {
  const gm = state.gms[gmIndex]!;
  gm.teamCode = teamCode;
  gm.isHuman = true;
  state.teams[teamCode]!.controlledBy = { kind: "human", gmId: gm.id };
  clearReadinessOnline(state);
}

describe("starting an online league", () => {
  it("counts the seats nobody has taken", () => {
    const state = onlineLeague(4);
    expect(openSlots(state)).toBe(4);
    claim(state, 0, "KC");
    expect(openSlots(state)).toBe(3);
  });

  it("will not start with one GM while three seats are empty", () => {
    const state = onlineLeague(4);
    claim(state, 0, "KC");
    state.readiness[state.gms[0]!.id] = true;

    // readiness alone says go — every other slot is an AI with nobody to
    // wait for, which is exactly the trap
    expect(humanGate(state)).toBe(true);
    expect(rosterGate(state)).toBe(false);
    expect(heldBy(state)).toEqual({ openSlots: 3 });
  });

  it("starts once the last seat is taken and everyone is ready", () => {
    const state = onlineLeague(2);
    claim(state, 0, "KC");
    claim(state, 1, "BUF");
    expect(rosterGate(state)).toBe(true);

    state.readiness[state.gms[0]!.id] = true;
    expect(humanGate(state)).toBe(false); // the other GM hasn't clicked

    state.readiness[state.gms[1]!.id] = true;
    expect(humanGate(state)).toBe(true);
    expect(heldBy(state)).toBeNull();
  });

  it("only guards the start; later stages are held by readiness alone", () => {
    const state = onlineLeague(4);
    claim(state, 0, "KC");
    state.stage = "fantasyDraft";
    // three seats are still empty and that is now fine — they are AI teams
    expect(openSlots(state)).toBe(3);
    expect(rosterGate(state)).toBe(true);
    expect(heldBy(state)).toBeNull();
  });

  it("leaves a single-player dynasty alone", () => {
    const solo = createLeague(7, DEFAULT_CONFIG);
    solo.stage = "setup";
    solo.gms[0]!.teamCode = "KC"; // the viewer picks; the rest are seeded
    expect(openSlots(solo)).toBe(0);
    expect(rosterGate(solo)).toBe(true);
  });

  it("lets the commissioner start short, deliberately", () => {
    const state = onlineLeague(4);
    claim(state, 0, "KC");
    state.readiness[state.gms[0]!.id] = true;
    expect(rosterGate(state)).toBe(false);

    // `forceAdvance` calls this directly, bypassing the gates by design
    const before = state.stage;
    expect(advanceStage(state).moved).toBe(true);
    expect(state.stage).not.toBe(before);
    // and the empty seats stay AI rather than becoming phantom humans
    expect(state.gms.filter((g) => g.isHuman)).toHaveLength(1);
  });
});
