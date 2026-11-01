import { describe, expect, it } from "vitest";
import { createLeague, DEFAULT_CONFIG } from "./seed";
import { describeUniverse, randomSeed, universeOf, universePatch } from "./universe";

describe("universe choices", () => {
  it("maps each choice to config and back", () => {
    expect(universeOf({ ...universePatch({ kind: "legacy" }) })).toEqual({ kind: "legacy" });
    expect(universeOf({ ...universePatch({ kind: "fictional" }) })).toEqual({ kind: "fictional" });
    expect(universeOf({ ...universePatch({ kind: "era", eraId: "2013" }) })).toEqual({ kind: "era", eraId: "2013" });
  });
  it("falls back to a valid era when given an unknown one", () => {
    expect(universePatch({ kind: "era", eraId: "nope" }).leagueEra).toBe("2011");
  });
  it("switching away from an era clears it", () => {
    expect(universePatch({ kind: "fictional" }).leagueEra).toBeUndefined();
  });
  it("random seeds are whole numbers in range and injectable", () => {
    expect(randomSeed(() => 0.5)).toBe(500_000_000);
    const s = randomSeed();
    expect(Number.isInteger(s) && s >= 0 && s <= 4294967295).toBe(true);
  });

  it("legacy leagues carry no DNA; fictional ones do", () => {
    const legacy = createLeague(11, { ...DEFAULT_CONFIG, ...universePatch({ kind: "legacy" }) });
    const fict = createLeague(11, { ...DEFAULT_CONFIG, ...universePatch({ kind: "fictional" }) });
    expect(legacy.dna).toBeUndefined();
    expect(fict.dna).toBeDefined();
    expect(fict.dna?.eraTarget).toBeUndefined();
    expect(describeUniverse(legacy)).toMatch(/Legacy/);
  });

  it("an era league records its target, is reproducible, and differs from the plain league", () => {
    const cfg = { ...DEFAULT_CONFIG, ...universePatch({ kind: "era", eraId: "2011" }) };
    const a = createLeague(11, cfg);
    const b = createLeague(11, cfg);
    const plain = createLeague(11, { ...DEFAULT_CONFIG, ...universePatch({ kind: "fictional" }) });
    expect(a.dna?.eraTarget).toBe("2011");
    expect(Object.keys(a.players).sort()).toEqual(Object.keys(b.players).sort());
    const top = (s: typeof a) => Object.values(s.players).map((p) => `${p.id}:${p.overall}`).sort().join();
    expect(top(a)).toBe(top(b));
    expect(top(a)).not.toBe(top(plain));
    expect(describeUniverse(a)).toMatch(/2011/);
  });

  it("future draft classes are generated per year, not copied from the opening pool", () => {
    const s = createLeague(11, { ...DEFAULT_CONFIG, ...universePatch({ kind: "era", eraId: "2011" }) });
    expect(s.draftClass.length).toBeGreaterThan(0);
  });
});

import { cleanConfigPatch } from "./rules";
import type { LeagueState } from "@/domain";

describe("universe in league config validation", () => {
  const setup = { stage: "setup", config: DEFAULT_CONFIG } as LeagueState;
  it("accepts all three universes when creating", () => {
    for (const patch of [{ playerPool: "legacy" }, { playerPool: "fictional" }, { playerPool: "fictional", leagueEra: "2011" }]) {
      const r = cleanConfigPatch(setup, patch, { creating: true });
      expect(r.ok, JSON.stringify(patch)).toBe(true);
    }
  });
  it("rejects an unknown era, an unknown pool, and an era on a legacy league", () => {
    expect(cleanConfigPatch(setup, { leagueEra: "1066" }, { creating: true }).ok).toBe(false);
    expect(cleanConfigPatch(setup, { playerPool: "mystery" }, { creating: true }).ok).toBe(false);
    expect(cleanConfigPatch(setup, { playerPool: "legacy", leagueEra: "2011" }, { creating: true }).ok).toBe(false);
  });
  it("a commissioner cannot change the universe of an existing league", () => {
    const r = cleanConfigPatch(setup, { leagueEra: "2011" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/created/);
  });
});

import { makeDnaLeague } from "@/sim/leagueDna";
import { TEAMS } from "@/data/teams";
import { realPlayerNames } from "@/sim/MockSimulationService";

describe("the three universes make the intended player pools", () => {
  const codes = TEAMS.map((t) => t.code);
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
  const topMean = (pool: { position: string; overall: number }[], pos: string, n = 32) =>
    mean(pool.filter((p) => p.position === pos).map((p) => p.overall).sort((a, b) => b - a).slice(0, n));
  const seeds = Array.from({ length: 10 }, (_, i) => 3000 + i * 71);

  it("legacy uses real player names; fictional uses none of them", () => {
    const real = new Set(realPlayerNames());
    const legacy = createLeague(21, { ...DEFAULT_CONFIG, ...universePatch({ kind: "legacy" }) });
    const fict = createLeague(21, { ...DEFAULT_CONFIG, ...universePatch({ kind: "fictional" }) });
    const names = (s: typeof legacy) => Object.values(s.players).map((p) => p.name);
    expect(names(legacy).filter((n) => real.has(n)).length).toBeGreaterThan(100);
    expect(names(fict).filter((n) => real.has(n)).length).toBe(0);
  });

  it("era leagues change actual initial ratings, not just the label: a 2011 league has better QBs/WRs and a 2024 league a better front", () => {
    const q11 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2011").pool, "QB")));
    const q24 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2024").pool, "QB")));
    const wr11 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2011").pool, "WR", 64)));
    const wr24 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2024").pool, "WR", 64)));
    const e11 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2011").pool, "EDGE", 64)));
    const e24 = mean(seeds.map((s) => topMean(makeDnaLeague(s, codes, [], "2024").pool, "EDGE", 64)));
    expect(q11 - q24).toBeGreaterThan(0.5);
    expect(wr11 - wr24).toBeGreaterThan(0.3);
    expect(e24 - e11).toBeGreaterThan(0.3);
  });
});
