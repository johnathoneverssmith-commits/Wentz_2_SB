import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { agingDelta } from "@/sim/MockSimulationService";
import { Rng } from "@/sim/rng.ts";

import { applySeasonAging, createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { commitRetirements } from "./store.ts";

/**
 * OQ-4: players previously never aged or retired within the franchise loop
 * at all — `dev_age_threshold`/`decline_age_threshold` were set on every
 * player but nothing ever read them, and RetirementReview.tsx only ever
 * *displayed* who'd retire without actually removing them. `applySeasonAging`
 * (season rollover) and `commitRetirements` (leaving retirement review) close
 * both gaps.
 */

function fixture(): LeagueState {
  return createLeague(1, DEFAULT_CONFIG);
}

describe("agingDelta", () => {
  it("is net-positive across many draws while developing (age well below dev threshold)", () => {
    const rng = new Rng(1);
    let total = 0;
    for (let i = 0; i < 200; i++) total += agingDelta(rng, 22, 26, 33);
    expect(total).toBeGreaterThan(0);
  });

  it("is roughly flat across many draws during prime years", () => {
    const rng = new Rng(2);
    let total = 0;
    const n = 400;
    for (let i = 0; i < n; i++) total += agingDelta(rng, 28, 26, 33);
    // small random walk, not a big net trend either way
    expect(Math.abs(total / n)).toBeLessThan(0.6);
  });

  it("is net-negative and grows harsher the further past the decline threshold", () => {
    const rng = new Rng(3);
    let justPast = 0;
    let farPast = 0;
    const n = 150;
    for (let i = 0; i < n; i++) justPast += agingDelta(rng, 34, 26, 33); // 1 year past
    for (let i = 0; i < n; i++) farPast += agingDelta(rng, 40, 26, 33); // 7 years past
    expect(justPast).toBeLessThan(0);
    expect(farPast).toBeLessThan(justPast); // more negative
  });
});

describe("applySeasonAging", () => {
  it("ages every active player by exactly one year and leaves retired players untouched", () => {
    const s = fixture();
    const anyPlayer = Object.values(s.players)[0]!;
    const retiredPlayer = Object.values(s.players)[1]!;
    retiredPlayer.retired = true;
    const beforeAge = anyPlayer.age;
    const retiredAgeBefore = retiredPlayer.age;
    const retiredOverallBefore = retiredPlayer.overall;

    applySeasonAging(s, s.season + 1);

    expect(anyPlayer.age).toBe(beforeAge + 1);
    expect(retiredPlayer.age).toBe(retiredAgeBefore);
    expect(retiredPlayer.overall).toBe(retiredOverallBefore);
  });

  it("keeps overall within schema bounds after aging", () => {
    const s = fixture();
    applySeasonAging(s, s.season + 1);
    for (const p of Object.values(s.players)) {
      expect(p.overall).toBeGreaterThanOrEqual(40);
      expect(p.overall).toBeLessThanOrEqual(99);
    }
  });

  it("is deterministic for the same season", () => {
    const a = fixture();
    const b: LeagueState = JSON.parse(JSON.stringify(a));
    applySeasonAging(a, 2027);
    applySeasonAging(b, 2027);
    const pid = Object.keys(a.players)[0]!;
    expect(a.players[pid]!.overall).toBe(b.players[pid]!.overall);
    expect(a.players[pid]!.age).toBe(b.players[pid]!.age);
  });
});

describe("commitRetirements", () => {
  it("actually retires the players retirementOutcomes flags, not just a display list", () => {
    const s = fixture();
    // push a bunch of players well past their position's retirement norm so
    // at least one is guaranteed to be flagged "retiring" this season
    let aged = 0;
    for (const p of Object.values(s.players)) {
      if (aged >= 40) break;
      p.age = 45;
      aged++;
    }
    commitRetirements(s);
    const retiredCount = Object.values(s.players).filter((p) => p.retired).length;
    expect(retiredCount).toBeGreaterThan(0);
  });

  it("retirement is monotonic - once retired, a player stays retired on a later call", () => {
    const s = fixture();
    for (const p of Object.values(s.players)) p.age = 45;
    commitRetirements(s);
    const firstPass = new Set(Object.values(s.players).filter((p) => p.retired).map((p) => p.id));
    // a later call only ever sees the still-active pool (RetirementReview's
    // own filter is `!p.retired`) - it can retire more, never un-retire
    commitRetirements(s);
    const secondPass = new Set(Object.values(s.players).filter((p) => p.retired).map((p) => p.id));
    for (const id of firstPass) expect(secondPass.has(id)).toBe(true);
  });
});
