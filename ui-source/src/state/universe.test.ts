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
