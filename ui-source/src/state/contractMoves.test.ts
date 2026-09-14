import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";

import { extendContract, extensionAsk, previewRestructure, restructureContract } from "./contracts.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "./seed.ts";

/**
 * Restructure and Extend were buttons that said "Not available in this build
 * yet". That left a GM one lever for cap trouble — cut the player — and no way
 * at all to keep someone they wanted. Real cap management is mostly these two.
 */
function fixture(): { s: LeagueState; p: Player } {
  const s = createLeague(23, DEFAULT_CONFIG);
  fillRosterGaps(s);
  recomputeTeamRatings(s);
  const p = Object.values(s.players).find(
    (x) => !x.free_agent && !x.retired && (x.contract?.cap_hit_by_year[0] ?? 0) > 8,
  )!;
  return { s, p };
}

function hits(p: Player): number[] {
  return p.contract!.cap_hit_by_year;
}

describe("restructure", () => {
  it("takes money off this year and puts it on the later ones", () => {
    const { p } = fixture();
    p.contract!.years_remaining = 4;
    p.contract!.cap_hit_by_year = [20, 20, 20, 20];

    const before = hits(p).reduce((a, b) => a + b, 0);
    const r = restructureContract(p);

    expect(r.ok).toBe(true);
    expect(hits(p)[0]).toBeLessThan(20);
    expect(hits(p)[1]).toBeGreaterThan(20);
    // the money moved, it didn't vanish — no dead money, but no free lunch
    expect(hits(p).reduce((a, b) => a + b, 0)).toBeCloseTo(before, 1);
  });

  it("reports the room it frees, and frees it", () => {
    const { p } = fixture();
    p.contract!.years_remaining = 3;
    p.contract!.cap_hit_by_year = [30, 10, 10];
    const before = hits(p)[0]!;

    const r = restructureContract(p);

    expect(before - hits(p)[0]!).toBeCloseTo(r.freed!, 1);
  });

  it("refuses a deal with no later years to push money into", () => {
    const { p } = fixture();
    p.contract!.years_remaining = 1;
    p.contract!.cap_hit_by_year = [20];
    const r = previewRestructure(p);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/later years/i);
  });

  it("refuses a deal already at the minimum", () => {
    const { p } = fixture();
    p.contract!.years_remaining = 3;
    p.contract!.cap_hit_by_year = [1, 1, 1];
    expect(previewRestructure(p).ok).toBe(false);
  });

  it("guarantees the money it converts", () => {
    const { p } = fixture();
    p.contract!.years_remaining = 4;
    p.contract!.cap_hit_by_year = [20, 20, 20, 20];
    const before = p.contract!.guaranteed;
    restructureContract(p);
    expect(p.contract!.guaranteed).toBeGreaterThan(before);
  });
});

describe("extend", () => {
  it("adds the years at the agreed rate, leaving this season alone", () => {
    const { s, p } = fixture();
    s.teams[p.nfl_team]!.cap.total = 400; // room to work with
    const thisYear = hits(p)[0]!;
    const ask = extensionAsk(p);

    const r = extendContract(s, p, ask);

    expect(r.ok).toBe(true);
    expect(hits(p)[0]).toBe(thisYear);
    expect(p.contract!.years_remaining).toBe(1 + ask.years);
    expect(hits(p)[1]).toBeCloseTo(ask.baseSalary, 1);
  });

  it("is turned down when the offer is short of what he'd get on the market", () => {
    const { s, p } = fixture();
    const ask = extensionAsk(p);
    const r = extendContract(s, p, { ...ask, baseSalary: ask.baseSalary * 0.4 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/looking for about/i);
  });

  it("is refused when the new years wouldn't fit under the cap", () => {
    const { s, p } = fixture();
    s.teams[p.nfl_team]!.cap.total = s.teams[p.nfl_team]!.cap.used; // no room at all
    const ask = extensionAsk(p);
    const r = extendContract(s, p, { ...ask, baseSalary: ask.baseSalary * 3, guaranteed: 999 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/over/i);
  });

  it("asks less of a player on the wrong side of thirty", () => {
    const { p } = fixture();
    p.age = 33;
    const old = extensionAsk(p).baseSalary;
    p.age = 24;
    const young = extensionAsk(p).baseSalary;
    expect(young).toBeGreaterThan(old);
  });
});

/**
 * Without carrying the prorated money forward, "restructure now, extend the
 * debt away later" is free money — the one thing proration never is.
 */
describe("restructure then extend", () => {
  it("still owes the money it pushed forward", () => {
    const { s, p } = fixture();
    s.teams[p.nfl_team]!.cap.total = 400;
    p.contract!.years_remaining = 4;
    p.contract!.cap_hit_by_year = [24, 24, 24, 24];

    restructureContract(p);
    const carried = p.contract!.prorated_per_year!;
    expect(carried).toBeGreaterThan(0);

    const ask = extensionAsk(p);
    extendContract(s, p, ask);

    // every extension year carries the old bonus on top of the new salary
    expect(hits(p)[1]).toBeCloseTo(ask.baseSalary + carried, 1);
  });

  it("counts that carried money when checking next year's cap", () => {
    const { s, p } = fixture();
    p.contract!.years_remaining = 4;
    p.contract!.cap_hit_by_year = [24, 24, 24, 24];
    restructureContract(p);
    const ask = extensionAsk(p);
    // exactly enough room for the salary alone, none for the carried bonus
    s.teams[p.nfl_team]!.cap.total =
      s.teams[p.nfl_team]!.cap.used - (p.contract!.cap_hit_by_year[1] ?? 0) + ask.baseSalary;
    expect(extendContract(s, p, ask).ok).toBe(false);
  });
});
