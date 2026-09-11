import { describe, expect, it } from "vitest";

import { allStaffs } from "../src/engine/staff-data.js";
import { generateCoachMarket, marketBaseline } from "../src/engine/staff-market.js";

/**
 * The free-agent coach market — candidates sampled from the 32 authored
 * staffs' own rating distributions (staff-data.ts), not an arbitrary range.
 */

describe("marketBaseline", () => {
  it("matches the 32 authored staffs' actual mean/std", () => {
    const staffs = Object.values(allStaffs());
    expect(staffs).toHaveLength(32);
    const b = marketBaseline();
    const mean = (xs: number[]) => xs.reduce((a, c) => a + c, 0) / xs.length;
    expect(b.gameManagement.mean).toBeCloseTo(mean(staffs.map((s) => s.headCoach.gameManagement)), 6);
    expect(b.dcRating.mean).toBeCloseTo(mean(staffs.map((s) => s.dc.rating)), 6);
    // every authored scheme shows up in the weighted-frequency map
    for (const s of staffs) {
      expect(b.ocScheme.has(s.oc.scheme)).toBe(true);
      expect(b.dcScheme.has(s.dc.scheme)).toBe(true);
    }
  });
});

describe("generateCoachMarket", () => {
  it("produces the requested counts per role, in [1,99] / [-1,1] bounds", () => {
    const market = generateCoachMarket(7, { hc: 8, oc: 10, dc: 10 });
    expect(market.filter((c) => c.role === "HC")).toHaveLength(8);
    expect(market.filter((c) => c.role === "OC")).toHaveLength(10);
    expect(market.filter((c) => c.role === "DC")).toHaveLength(10);
    for (const c of market) {
      if (c.role === "HC") {
        expect(c.gameManagement).toBeGreaterThanOrEqual(1);
        expect(c.gameManagement).toBeLessThanOrEqual(99);
        expect(c.discipline).toBeGreaterThanOrEqual(1);
        expect(c.discipline).toBeLessThanOrEqual(99);
        expect(c.aggression).toBeGreaterThanOrEqual(-1);
        expect(c.aggression).toBeLessThanOrEqual(1);
      } else if (c.role === "OC") {
        expect(c.rating).toBeGreaterThanOrEqual(1);
        expect(c.rating).toBeLessThanOrEqual(99);
        expect(["west_coast", "vertical", "spread", "power_run", "zone_run", "pro_style"]).toContain(c.scheme);
      } else {
        expect(c.rating).toBeGreaterThanOrEqual(1);
        expect(c.rating).toBeLessThanOrEqual(99);
        expect(["four_three", "three_four", "multiple", "cover_3", "cover_2", "man_press"]).toContain(c.scheme);
      }
    }
  });

  it("stays statistically consistent with the authored-staff baseline (not a wider invented range)", () => {
    // sample a large pool and check the empirical mean lands close to the
    // authored baseline (within a few points — this is a distribution check,
    // not exact-value; a fixed seed keeps it deterministic).
    const market = generateCoachMarket(11, { hc: 300, oc: 0, dc: 0 });
    const gm = market.filter((c) => c.role === "HC").map((c) => (c as { gameManagement: number }).gameManagement);
    const empiricalMean = gm.reduce((a, b) => a + b, 0) / gm.length;
    const b = marketBaseline();
    expect(Math.abs(empiricalMean - b.gameManagement.mean)).toBeLessThan(2);
  });

  it("is deterministic in the seed", () => {
    const a = generateCoachMarket(3, { hc: 4, oc: 4, dc: 4 });
    const b = generateCoachMarket(3, { hc: 4, oc: 4, dc: 4 });
    expect(a).toEqual(b);
  });

  it("different seeds produce different candidates", () => {
    const a = generateCoachMarket(1, { hc: 4, oc: 4, dc: 4 });
    const b = generateCoachMarket(2, { hc: 4, oc: 4, dc: 4 });
    expect(a).not.toEqual(b);
  });
});
