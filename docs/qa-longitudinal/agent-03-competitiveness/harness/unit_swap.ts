/**
 * Agent 3 harness: controlled unit-swap experiment (read-only; no production code touched).
 * usage: NFL_POOL_PATH=ui-source/src/data/pool-2026.json npx tsx unit_swap.ts <unit> <delta|abs:N> <reps> <talent> [staff]
 * Every one of the 32 rosters is the base. Its <unit> starters get attributes+overall shifted by delta
 * (or QB set to overall N). The treated roster and the untreated roster play the SAME seeds, venue and
 * opponent, so per-game difference is a paired comparison. Prints one JSON line.
 */
import { NFL_TEAMS } from "../../../../src/engine/nfl-structure.js";
import { Roster, roster } from "../../../../src/engine/roster.js";
import { simulateGame } from "../../../../src/engine/sim.js";
import { teamStaff } from "../../../../src/engine/staff-data.js";
import { weatherFor } from "../../../../src/engine/weather.js";
import type { Player } from "../../../../src/schema/player.js";

const [UNIT, DELTA, REPS, TALENT] = [process.argv[2]!, process.argv[3]!, Number(process.argv[4]), Number(process.argv[5] ?? 1)];
const USE_STAFF = process.argv[6] === "staff";
const UNITS: Record<string, { pos: string[]; n: Record<string, number> }> = {
  QB: { pos: ["QB"], n: { QB: 1 } },
  OL: { pos: ["C", "OG", "OT"], n: { C: 1, OG: 2, OT: 2 } },
  WRTE: { pos: ["WR", "TE"], n: { WR: 3, TE: 1 } },
  RB: { pos: ["RB"], n: { RB: 1 } },
  FRONT: { pos: ["EDGE", "DT"], n: { EDGE: 2, DT: 2 } },
  LB: { pos: ["ILB"], n: { ILB: 2 } },
  SECONDARY: { pos: ["CB", "S"], n: { CB: 3, S: 2 } },
  K: { pos: ["K"], n: { K: 1 } },
  P: { pos: ["P"], n: { P: 1 } },
};
const u = UNITS[UNIT]!;
const shift = (p: Player, d: number): Player => {
  const attrs: Record<string, any> = {};
  for (const [k, v] of Object.entries(p.attributes ?? {})) attrs[k] = typeof v === "number" ? Math.max(1, Math.min(99, v + d)) : v;
  return { ...p, id: `${p.id}~${d}`, overall: Math.max(1, Math.min(99, (p.overall ?? 0) + d)), attributes: attrs } as Player;
};
function treat(base: Roster): Roster {
  const out: Player[] = [];
  for (const [pos, ps] of base.depth) {
    const k = u.n[pos] ?? 0;
    ps.forEach((p, i) => {
      if (i < k) {
        const d = DELTA.startsWith("abs:") ? Number(DELTA.slice(4)) - (ps[0]!.overall ?? 0) : Number(DELTA);
        out.push(shift(p, d));
      } else out.push(p);
    });
  }
  return new Roster(base.team, out);
}
const teams = [...NFL_TEAMS];
const res: number[] = []; const win: number[] = [];
for (let rep = 0; rep < REPS; rep++) teams.forEach((t, ti) => {
  const o = teams[(ti + 1 + ((rep * 11 + ti * 5) % 31)) % 32]!; const home = (rep + ti) % 2 === 0;
  const seed = 5_100_000 + rep * 1009 + ti;
  const run = (r: Roster) => {
    const h = home ? t : o, a = home ? o : t;
    const g = simulateGame(seed, h, a, { homeRoster: home ? r : roster(o), awayRoster: home ? roster(o) : r, overtime: "nfl", injuries: true, talentScale: TALENT,
      weather: weatherFor(h, "REG", 1 + (rep % 17), seed), ...(USE_STAFF ? { homeStaff: teamStaff(h)!, awayStaff: teamStaff(a)! } : {}) });
    const m = home ? g.score[0]! - g.score[1]! : g.score[1]! - g.score[0]!;
    return m;
  };
  const b = roster(t); const m0 = run(b), m1 = run(treat(b));
  res.push(m1 - m0); win.push(Math.sign(m1) - Math.sign(m0));
});
const n = res.length, mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
console.log(JSON.stringify({ unit: UNIT, delta: DELTA, talent: TALENT, n, dMargin: +mean(res).toFixed(3), seMargin: +(sd(res) / Math.sqrt(n)).toFixed(3),
  dWinPct: +(50 * mean(win)).toFixed(2), seWinPct: +(50 * sd(win) / Math.sqrt(n)).toFixed(2) }));
