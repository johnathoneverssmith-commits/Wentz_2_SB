/** Agent 3 probe: for a synthetic 27-year-old at each position and rating, free-agent asking salary (expectedSalary) vs trade-chart performance value
 * (playerPerformanceValue). Read-only. Copy to ui-source/src/state/_a3_price.test.ts and run: npx vitest run src/state/_a3_price.test.ts */
import { describe, it } from "vitest";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";
import { expectedSalary } from "@/state/freeAgencyValues.ts";
import { playerPerformanceValue } from "@/sim/MockSimulationService";
describe("a3 price", () => { it("prints", async () => {
  const s = createLeague(9301, { ...DEFAULT_CONFIG });
  const base = Object.values(s.players)[0]!;
  const rows: string[] = ["pos,ovr,salaryM,tradeValue,tradePerSalaryM"];
  for (const pos of ["QB","RB","WR","TE","OT","OG","C","EDGE","DT","ILB","CB","S","K","P"]) for (const ovr of [75, 85, 92]) {
    const p = { ...base, position: pos, overall: ovr, age: 27, injury_status: null } as any;
    const sal = expectedSalary(p), tv = playerPerformanceValue(s, p);
    rows.push(`${pos},${ovr},${sal.toFixed(2)},${tv.toFixed(1)},${(tv / sal).toFixed(2)}`);
  }
  (await import("node:fs")).writeFileSync(process.env.A3_OUT ?? "price.csv", rows.join("\n") + "\n");
}); });
