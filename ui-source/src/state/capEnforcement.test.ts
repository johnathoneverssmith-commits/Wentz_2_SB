import { describe, expect, it } from "vitest";

import type { ContractOffer, LeagueState } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { checkStandingSign } from "./store.ts";

/**
 * signStandingFreeAgent (human-side follow-up to OQ-9's AI cap enforcement):
 * previously this action had no cap check at all - a human GM could sign a
 * standing free agent for any amount regardless of `team.cap.total -
 * team.cap.used`. checkStandingSign is the pure gate it now runs through
 * before the store actually commits the signing.
 */

function fixture(): LeagueState {
  return createLeague(1, DEFAULT_CONFIG);
}

function offerFor(teamCode: string, baseSalary: number, years = 1): ContractOffer {
  return { teamCode, baseSalary, signingBonus: 0, years, guaranteed: 0 };
}

function makeFreeAgent(s: LeagueState) {
  const p = Object.values(s.players)[0]!;
  p.free_agent = true;
  return p;
}

describe("checkStandingSign", () => {
  it("rejects an offer whose year-1 cap hit exceeds the team's remaining room", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const team = s.teams[teamCode]!;
    team.cap.total = 200;
    team.cap.used = 195; // 5M room

    const result = checkStandingSign(s, fa.id, offerFor(teamCode, 40)); // way over
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cap space/i);
  });

  it("accepts an offer that fits within remaining cap room", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const team = s.teams[teamCode]!;
    team.cap.total = 200;
    team.cap.used = 100; // 100M room

    const result = checkStandingSign(s, fa.id, offerFor(teamCode, 5));
    expect(result.ok).toBe(true);
  });

  it("rejects signing a player who isn't actually a free agent", () => {
    const s = fixture();
    const rostered = Object.values(s.players).find((p) => !p.free_agent)!;
    const teamCode = Object.keys(s.teams)[0]!;
    const result = checkStandingSign(s, rostered.id, offerFor(teamCode, 1));
    expect(result.ok).toBe(false);
  });

  it("never mutates the state it's given (read-only check)", () => {
    const s = fixture();
    const fa = makeFreeAgent(s);
    const teamCode = Object.keys(s.teams)[0]!;
    const before = JSON.stringify(s.teams[teamCode]);
    checkStandingSign(s, fa.id, offerFor(teamCode, 3));
    expect(JSON.stringify(s.teams[teamCode])).toBe(before);
  });
});
