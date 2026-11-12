/**
 * X4 (engine-only, real engine): is an OPPONENT-SPECIFIC game plan worth more than one good generic plan?
 *   NFL_POOL_PATH=<pool> npx tsx x04_opponent_tailoring.ts <matchups> <gamesPerPlanPerMatchup> <talent> <out.jsonl>
 * For each random matchup (real 2026 rosters, no staffs, no weather) the focal team plays the SAME seeds under 7 plans.
 * Seeds 0..G/2-1 are the "selection half", G/2..G-1 the "evaluation half" (analysis picks on one, scores on the other).
 */
import { writeFileSync } from "node:fs";
import { cleanPlan, type GamePlan } from "../../../../../src/engine/gameplan.js";
import { roster, teamList } from "../../../../../src/engine/roster.js";
import { simulateGame } from "../../../../../src/engine/sim.js";
const [M, G, TALENT, OUT] = [Number(process.argv[2] ?? 32), Number(process.argv[3] ?? 100), Number(process.argv[4] ?? 1.5), process.argv[5] ?? "x04.jsonl"];
const teams = teamList();
const PLANS: Record<string, Partial<GamePlan>> = {
  std: {}, pass15: { passRate: 15 }, run15: { passRate: -15 }, blitz70: { blitz: 70 }, noblitz: { blitz: -70 },
  twelve: { p11: 30, p12: 55, p13: 15 }, aggr4: { fourthOpp: 70, fourthRedZone: 70, fourthShort: 60 },
};
let rs = 12345; const rnd = () => (rs = (rs * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const lines: string[] = [];
for (let m = 0; m < M; m++) {
  const a = Math.floor(rnd() * teams.length); let b = Math.floor(rnd() * teams.length); if (b === a) b = (b + 1) % teams.length;
  const focal = teams[a]!, opp = teams[b]!, home = m % 2 === 0;
  for (const [name, plan] of Object.entries(PLANS)) {
    const margins: number[] = [];
    for (let k = 0; k < G; k++) {
      const g = simulateGame(6_000_000 + m * 10007 + k * 31, home ? focal : opp, home ? opp : focal, {
        homeRoster: roster(home ? focal : opp), awayRoster: roster(home ? opp : focal), overtime: "nfl", injuries: true, talentScale: TALENT,
        ...(home ? { homePlan: cleanPlan(plan) } : { awayPlan: cleanPlan(plan) }),
      });
      margins.push(home ? g.score[0] - g.score[1] : g.score[1] - g.score[0]);
    }
    lines.push(JSON.stringify({ m, focal, opp, home, plan: name, margins }));
  }
  writeFileSync(OUT, lines.join("\n"));
}
