import { describe, expect, it } from "vitest";
import { TEAMS } from "@/data/teams";
import { atmosphereName, atmospherePalette } from "./atmosphere";
import { NEUTRAL_SPEC, specFor, STADIUM_SPECS } from "./stadiumSpec";

describe("stadium specs", () => {
  it("every one of the 32 teams has its own spec", () => {
    for (const t of TEAMS) expect(STADIUM_SPECS[t.code], t.code).toBeDefined();
    expect(Object.keys(STADIUM_SPECS).sort()).toEqual(TEAMS.map((t) => t.code).sort());
  });
  it("no two teams share a composition (roof + landmarks + tiers)", () => {
    const seen = new Map<string, string>();
    for (const [code, s] of Object.entries(STADIUM_SPECS)) {
      const key = [s.roof, s.tiers, ...s.landmarks].join("|");
      expect(seen.get(key), `${code} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, code);
    }
  });
  it("unknown or missing team falls back to neutral", () => {
    expect(specFor(undefined)).toBe(NEUTRAL_SPEC);
    expect(specFor("ZZZ")).toBe(NEUTRAL_SPEC);
  });
});

describe("atmosphere palette", () => {
  it("is neutral at 0.5: no rays, embers, smoke or fire", () => {
    const p = atmospherePalette(0.5);
    expect([p.rays, p.embers, p.smoke, p.fire]).toEqual([0, 0, 0, 0]);
  });
  it("top is heavenly: bright, rays, no fire", () => {
    const p = atmospherePalette(1);
    expect(p.rays).toBe(1);
    expect(p.daylight).toBe(1);
    expect(p.fire + p.embers + p.smoke).toBe(0);
  });
  it("bottom is infernal: dark, fire, embers, smoke, no rays", () => {
    const p = atmospherePalette(0);
    expect(p.fire).toBe(1);
    expect(p.embers).toBe(1);
    expect(p.smoke).toBe(1);
    expect(p.rays).toBe(0);
    expect(p.daylight).toBeLessThan(0.1);
  });
  it("grades smoothly and monotonically between the extremes", () => {
    let prevDay = -1;
    let prevFire = 2;
    for (let i = 0; i <= 20; i++) {
      const p = atmospherePalette(i / 20);
      expect(p.daylight).toBeGreaterThanOrEqual(prevDay - 1e-9);
      expect(p.fire).toBeLessThanOrEqual(prevFire + 1e-9);
      prevDay = p.daylight;
      prevFire = p.fire;
    }
  });
  it("clamps and survives bad input", () => {
    expect(atmospherePalette(5)).toEqual(atmospherePalette(1));
    expect(atmospherePalette(-3)).toEqual(atmospherePalette(0));
    expect(atmospherePalette(NaN)).toEqual(atmospherePalette(0.5));
  });
  it("names are neutral until the ranking is meaningful", () => {
    expect(atmosphereName(1, false)).toBe("Neutral");
    expect(atmosphereName(1, true)).toBe("Heavenly");
    expect(atmosphereName(0, true)).toBe("Infernal");
  });
});
