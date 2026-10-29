import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService, retirementDraw } from "@/sim/MockSimulationService.ts";
import { commitRetirements, retirementSeed } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

/**
 * Retirement is one rule for the local store and the online server
 * (`commitRetirements`, called from `store.ts` and `online/src/phases.ts`).
 * Each player's fate must depend on the season and his id only: the server
 * keeps players in whatever order its JSON round trip gives it, a client in
 * another, and the two must retire the same people.
 */
function aged(): LeagueState {
  const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
  let n = 0;
  for (const p of Object.values(s.players)) {
    if (n++ % 3 === 0) p.age += 8;
  }
  return s;
}
const sim = new MockSimulationService();
const base = aged();
const copy = (): LeagueState => JSON.parse(JSON.stringify(base)) as LeagueState;
const retiredIds = (s: LeagueState): string[] =>
  Object.values(s.players).filter((p) => p.retired).map((p) => p.id).sort();

describe("commitRetirements across storage order and reload", () => {
  it("retires the same players whatever order the players map is stored in", () => {
    const a = copy();
    const b = copy();
    b.players = Object.fromEntries(Object.entries(b.players).reverse());
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(a).length).toBeGreaterThan(10);
    expect(retiredIds(b)).toEqual(retiredIds(a));
  });

  it("retires the same players after the state is serialised and read back, as the server does", () => {
    const a = copy();
    const b = copy();
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(b)).toEqual(retiredIds(a));
  });

  it("retires a different group in a different season", () => {
    const a = copy();
    const b = copy();
    b.season += 1;
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(b)).not.toEqual(retiredIds(a));
  });
});

describe("retirement is independent across leagues", () => {
  const withSeed = (seed: number | undefined): LeagueState => {
    const s = copy();
    if (seed === undefined) delete s.seed;
    else s.seed = seed;
    return s;
  };

  it("retires different people in two leagues with the same players and season", () => {
    const a = withSeed(11);
    const b = withSeed(12);
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(a).length).toBeGreaterThan(10);
    expect(retiredIds(b)).not.toEqual(retiredIds(a));
  });

  it("replays the same league identically, before and after a reload, in any order", () => {
    const a = withSeed(11);
    const b = JSON.parse(JSON.stringify(withSeed(11))) as LeagueState;
    b.players = Object.fromEntries(Object.entries(b.players).reverse());
    commitRetirements(a);
    commitRetirements(b);
    expect(retiredIds(b)).toEqual(retiredIds(a));
  });

  it("does not depend on which other players are in the draw", () => {
    const s = withSeed(11);
    const all = new Map(sim.retirementOutcomes(retirementSeed(s), Object.values(s.players)).map((o) => [o.playerId, o.decision]));
    const half = sim.retirementOutcomes(retirementSeed(s), Object.values(s.players).filter((_, i) => i % 2));
    for (const o of half) expect(all.get(o.playerId)).toBe(o.decision);
  });

  it("reads the recorded seed and generates nothing: a save without one keeps the season-only key", () => {
    const old = withSeed(undefined);
    expect(retirementSeed(old)).toBe(old.season);
    const before = JSON.stringify(old);
    retirementSeed(old);
    expect(JSON.stringify(old)).toBe(before);
    expect(retirementSeed(withSeed(11))).not.toBe(retirementSeed(withSeed(12)));
  });

  it("negative control: with the league seed left out of the key, two leagues retire the same people", () => {
    const s = withSeed(11);
    const t = withSeed(12);
    const ids = (x: LeagueState) =>
      sim.retirementOutcomes(x.season, Object.values(x.players)).filter((o) => o.decision === "retiring").map((o) => o.playerId).sort();
    expect(ids(s)).toEqual(ids(t));
  });

  it("never touches a retirement already committed", () => {
    const s = withSeed(11);
    commitRetirements(s);
    const done = retiredIds(s);
    s.seed = 99;
    commitRetirements(s);
    expect(done.every((id) => s.players[id]!.retired)).toBe(true);
  });
});

describe("retirementSeed keys", () => {
  it("are distinct for every league seed and season in a wide range", () => {
    const seen = new Set<number>();
    let n = 0;
    for (let seed = 0; seed < 3000; seed++) {
      for (let season = 2026; season < 2126; season++) { seen.add(retirementSeed({ seed, season })); n++; }
    }
    expect(seen.size).toBe(n);
  });
  it("give uncorrelated draws for the same players in neighbouring leagues", () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `p_${i}`);
    const draws = (seed: number): number[] => ids.map((id) => retirementDraw(retirementSeed({ seed, season: 2030 }), id));
    const a = draws(11), b = draws(12);
    const mean = (x: number[]): number => x.reduce((s, v) => s + v, 0) / x.length;
    const ma = mean(a), mb = mean(b);
    let cov = 0, va = 0, vb = 0;
    for (let i = 0; i < a.length; i++) { cov += (a[i]! - ma) * (b[i]! - mb); va += (a[i]! - ma) ** 2; vb += (b[i]! - mb) ** 2; }
    expect(Math.abs(cov / Math.sqrt(va * vb))).toBeLessThan(0.06);
    expect(ma).toBeGreaterThan(0.47);
    expect(ma).toBeLessThan(0.53);
  });
  it("a save with no league seed keeps the documented fallback: the season alone", () => {
    expect(retirementSeed({ season: 2031 })).toBe(2031);
    expect(retirementSeed({ season: 2031, seed: 0 })).toBe(2031);
  });
});
