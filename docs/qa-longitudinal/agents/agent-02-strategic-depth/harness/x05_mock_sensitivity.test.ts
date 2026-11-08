/**
 * X5 (MOCK fallback, labelled): how strongly does the standalone Mock turn team rating into wins?
 * Copy to ui-source/src/state/_a2s_x05.test.ts; A2S=1 npm --prefix ui-source run test -- src/state/_a2s_x05.test.ts
 * Compare with X1 year-1 (real engine, same seeds): wins-per-rating-point slope and r.
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps, recomputeTeamRatings } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
const ON = !!process.env.A2S;
describe.skipIf(!ON)("x05 mock sensitivity", () => {
  it("runs", () => {
    const sim = new MockSimulationService(); const out: any[] = [];
    for (const talent of ["realistic", "amplified"]) for (const seed of [9401, 9402, 9403, 9404, 9405, 9406, 9407, 9408]) {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, talentImpact: talent } as any);
      for (const g of s.gms) g.isHuman = false;
      fillRosterGaps(s); recomputeTeamRatings(s);
      s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
      const w: Record<string, number> = Object.fromEntries(Object.keys(s.teams).map((c) => [c, 0]));
      for (let wk = 1; wk <= 18; wk++) for (const g of sim.simulateWeek(s, wk, "REG")) { if (g.homeScore > g.awayScore) w[g.homeTeam]!++; else if (g.awayScore > g.homeScore) w[g.awayTeam]!++; }
      out.push({ talent, seed, ovr: Object.fromEntries(Object.entries(s.teams).map(([c, t]) => [c, t.ratings.overall])), wins: w });
    }
    writeFileSync(process.env.A2S_OUT ?? "x05.json", JSON.stringify(out));
  }, 300_000);
});
