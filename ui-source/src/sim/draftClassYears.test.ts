import { describe, expect, it } from "vitest";

import { MockSimulationService } from "./MockSimulationService";

/**
 * Every caller seeds the class with the season twice, and the old mixing
 * collapsed that to two values: 2028-2031 generated the same class, so the
 * 2029 rookie of the year was a prospect again in 2030.
 */
describe("draft classes year to year", () => {
  it("are different people every season", () => {
    const sim = new MockSimulationService();
    const names = (y: number) => new Set(sim.generateDraftClass(y, y).map((p) => `${p.name}|${p.school}`));
    for (let y = 2026; y < 2036; y++) {
      const a = names(y);
      const b = names(y + 1);
      const shared = [...a].filter((n) => b.has(n)).length;
      expect(shared, `${y} vs ${y + 1}`).toBeLessThan(a.size * 0.05);
    }
  });
});

describe("draft classes league to league", () => {
  it("are each league's own, not the same prospects in every league that year", async () => {
    const { createLeague, leagueSalt } = await import("@/state/seed.ts");
    const sim = new MockSimulationService();
    const a = createLeague(11);
    const b = createLeague(12);
    const names = (s: typeof a) => new Set(sim.generateDraftClass(2028 + leagueSalt(s), 2028).map((p) => `${p.name}|${p.school}`));
    const na = names(a);
    const shared = [...names(b)].filter((n) => na.has(n)).length;
    expect(shared).toBeLessThan(na.size * 0.05);
  });
});
