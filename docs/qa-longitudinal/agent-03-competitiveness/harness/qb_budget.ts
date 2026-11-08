/** Agent 3: equal-payroll QB test. QB rating +X (cost per the game's own FA price curve `expectedSalary`, age<=28, scale 1, max deal 24% of $255M);
 * the same dollars are taken evenly from the other 22 starters/rotation slots by lowering each one's rating until it is that much cheaper
 * (X<0 does the reverse: QB cheaper, others upgraded). Paired seeds vs the unmodified roster. usage: qb_budget.ts <X> <reps> <talent> */
import { NFL_TEAMS } from "../../../../src/engine/nfl-structure.js";
import { Roster, roster } from "../../../../src/engine/roster.js";
import { simulateGame } from "../../../../src/engine/sim.js";
import { weatherFor } from "../../../../src/engine/weather.js";
import type { Player } from "../../../../src/schema/player.js";
const [X, REPS, TALENT] = [Number(process.argv[2]), Number(process.argv[3]), Number(process.argv[4] ?? 1)];
const PV: Record<string, number> = { QB: 2.92, CB: 1.42, EDGE: 1.35, RB: 1.21, S: 1.11, OT: 1.0, ILB: 0.97, OG: 0.9, C: 0.9, WR: 0.87, TE: 0.84, DT: 0.79, K: 0.5, P: 0.25 }; // copied from MockSimulationService POSITION_VALUE
const price = (pos: string, o: number) => Math.min(61.2, Math.round((1.35 + Math.pow(Math.max(0, o - 60) / 39, 1.9) * 27.7) * (PV[pos] ?? 1) * 10) / 10);
const SLOTS: Record<string, number> = { QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, CB: 3, S: 2, K: 1, P: 1 };
const shift = (p: Player, d: number): Player => { const a: Record<string, any> = {}; for (const [k, v] of Object.entries(p.attributes ?? {})) a[k] = typeof v === "number" ? Math.max(1, Math.min(99, v + d)) : v;
  return { ...p, id: `${p.id}~${d}`, overall: Math.max(1, Math.min(99, (p.overall ?? 0) + d)), attributes: a } as Player; };
let usedDelta: number[] = [], qbDelta: number[] = [];
function treat(b: Roster): Roster {
  const qb = b.depth.get("QB")![0]!; const q0 = qb.overall ?? 0; const q1 = Math.max(40, Math.min(99, q0 + X));
  const dollars = price("QB", q1) - price("QB", q0); // >0 : spent on QB, to be recovered from the rest
  qbDelta.push(q1 - q0);
  const others: [string, number][] = []; for (const [pos, n] of Object.entries(SLOTS)) if (pos !== "QB") for (let i = 0; i < n; i++) others.push([pos, i]);
  const share = dollars / others.length; const out: Player[] = [];
  for (const [pos, ps] of b.depth) ps.forEach((p, i) => {
    if (pos === "QB" && i === 0) { out.push(shift(p, q1 - q0)); return; }
    if ((SLOTS[pos] ?? 0) > i && pos !== "QB") { const o = p.overall ?? 0; let best = 0, gap = 1e9;
      for (let d = -35; d <= 35; d++) { const g = Math.abs(price(pos, Math.max(40, Math.min(99, o + d))) - price(pos, o) + share); if (g < gap - 1e-9 || (Math.abs(g - gap) < 1e-9 && Math.abs(d) < Math.abs(best))) { gap = g; best = d; } }
      usedDelta.push(best); out.push(shift(p, best)); } else out.push(p); });
  return new Roster(b.team, out);
}
const teams = [...NFL_TEAMS]; const d: number[] = [], w: number[] = [];
for (let rep = 0; rep < REPS; rep++) teams.forEach((t, ti) => {
  const o = teams[(ti + 1 + ((rep * 11 + ti * 5) % 31)) % 32]!; const home = (rep + ti) % 2 === 0; const seed = 8_100_000 + rep * 1009 + ti;
  const run = (r: Roster) => { const h = home ? t : o, a = home ? o : t;
    const g = simulateGame(seed, h, a, { homeRoster: home ? r : roster(o), awayRoster: home ? roster(o) : r, overtime: "nfl", injuries: true, talentScale: TALENT, weather: weatherFor(h, "REG", 1 + (rep % 17), seed) });
    return home ? g.score[0]! - g.score[1]! : g.score[1]! - g.score[0]!; };
  const b = roster(t); const m0 = run(b), m1 = run(treat(b)); d.push(m1 - m0); w.push(Math.sign(m1) - Math.sign(m0)); });
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length; const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
console.log(JSON.stringify({ qbDeltaRequested: X, meanQbDeltaApplied: +mean(qbDelta).toFixed(2), meanOthersDelta: +mean(usedDelta).toFixed(2), talent: TALENT, n: d.length, dMargin: +mean(d).toFixed(3), seMargin: +(sd(d) / Math.sqrt(d.length)).toFixed(3), dWinPct: +(50 * mean(w)).toFixed(2), seWinPct: +(50 * sd(w) / Math.sqrt(d.length)).toFixed(2) }));
