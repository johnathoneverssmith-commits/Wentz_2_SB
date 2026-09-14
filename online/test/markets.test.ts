import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { advanceStage, clearReadinessOnline, onStageEntered, readyUpLocal } from "../src/phases.js";

/**
 * The two sealed-bid markets, which had the draft's bug exactly.
 *
 * The screen used to open them, so online they never opened: a league walked
 * through `coachingHiring` with nothing to hire from and reached free agency
 * with nobody on the market. Confirmed on the deployed server before the fix
 * — a league sat in the regular season with `coachingHire` still null, having
 * passed straight through the stage that exists to fill it.
 */
function leagueAt(stage: LeagueState["stage"]): LeagueState {
  const s = createLeague(77, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.stage = stage;
  clearReadinessOnline(s);
  return s;
}

describe("the sealed-bid markets", () => {
  it("opens the coaching market when the stage opens", () => {
    const s = leagueAt("coachingHiring");
    expect(s.coachingHire).toBeFalsy();
    onStageEntered(s);
    expect(s.coachingHire).toBeTruthy();
    expect(s.coachingHire!.day).toBe(1);
    expect(s.coachingHire!.mode).toBe("main");
    // every coach is on the market, or there is nobody to hire
    expect(Object.values(s.coaches).every((c) => c.team === null)).toBe(true);
  }, 60_000);

  it("opens the free-agent market when the stage opens", () => {
    const s = leagueAt("offseasonFreeAgency");
    expect(s.freeAgency).toBeFalsy();
    onStageEntered(s);
    expect(s.freeAgency).toBeTruthy();
    expect(s.freeAgency!.mode).toBe("main");
  }, 60_000);

  it("does not reopen a window that is already running", () => {
    const s = leagueAt("coachingHiring");
    onStageEntered(s);
    s.coachingHire!.day = 3;
    s.coachingHire!.bids = { someone: [] };
    onStageEntered(s);
    // reopening would throw away everybody's bids
    expect(s.coachingHire!.day).toBe(3);
    expect(s.coachingHire!.bids).toHaveProperty("someone");
  }, 60_000);

  it("turns the day when every GM is ready, instead of ending the stage", () => {
    const s = leagueAt("coachingHiring");
    onStageEntered(s);
    expect(s.coachingHire!.day).toBe(1);

    for (const g of s.gms) s.readiness[g.id] = true;
    const moved = readyUpLocal(s);

    // the stage is not over — the day resolved and a new one opened
    expect(moved).toBe(false);
    expect(s.stage).toBe("coachingHiring");
    expect(s.coachingHire!.day).toBe(2);
    // and everybody has to speak up again
    expect(s.gms.every((g) => !s.readiness[g.id])).toBe(true);
  }, 60_000);

  it("closes the window after the fifth day and then leaves the stage", () => {
    const s = leagueAt("coachingHiring");
    onStageEntered(s);
    for (let day = 0; day < 5; day++) {
      for (const g of s.gms) s.readiness[g.id] = true;
      readyUpLocal(s);
    }
    expect(s.coachingHire!.mode).toBe("standing");

    for (const g of s.gms) s.readiness[g.id] = true;
    expect(readyUpLocal(s)).toBe(true);
    expect(s.stage).not.toBe("coachingHiring");
  }, 120_000);
});
