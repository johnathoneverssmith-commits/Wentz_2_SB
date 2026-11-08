/** Agent 3: ONE starter upgraded (+10 overall+attributes) instead of a whole unit. usage: unit_single.ts <POS> <slotIndex> <delta> <reps> <talent>
 * Same paired-seed design as unit_swap.ts (seeds 6_100_000+...). Prints one JSON line. */
import { NFL_TEAMS } from "../../../../src/engine/nfl-structure.js";
import { Roster, roster } from "../../../../src/engine/roster.js";
import { simulateGame } from "../../../../src/engine/sim.js";
import { weatherFor } from "../../../../src/engine/weather.js";
import type { Player } from "../../../../src/schema/player.js";
const [POS, SLOT, DELTA, REPS, TALENT] = [process.argv[2]!, Number(process.argv[3]), Number(process.argv[4]), Number(process.argv[5]), Number(process.argv[6] ?? 1)];
const shift = (p: Player, d: number): Player => { const a: Record<string, any> = {}; for (const [k, v] of Object.entries(p.attributes ?? {})) a[k] = typeof v === "number" ? Math.max(1, Math.min(99, v + d)) : v;
  return { ...p, id: `${p.id}~${d}`, overall: Math.max(1, Math.min(99, (p.overall ?? 0) + d)), attributes: a } as Player; };
const treat = (b: Roster): Roster => { const out: Player[] = []; for (const [pos, ps] of b.depth) ps.forEach((p, i) => out.push(pos === POS && i === SLOT ? shift(p, DELTA) : p)); return new Roster(b.team, out); };
const teams = [...NFL_TEAMS]; const d: number[] = [], w: number[] = [];
for (let rep = 0; rep < REPS; rep++) teams.forEach((t, ti) => {
  const o = teams[(ti + 1 + ((rep * 11 + ti * 5) % 31)) % 32]!; const home = (rep + ti) % 2 === 0; const seed = 6_100_000 + rep * 1009 + ti;
  const run = (r: Roster) => { const h = home ? t : o, a = home ? o : t;
    const g = simulateGame(seed, h, a, { homeRoster: home ? r : roster(o), awayRoster: home ? roster(o) : r, overtime: "nfl", injuries: true, talentScale: TALENT, weather: weatherFor(h, "REG", 1 + (rep % 17), seed) });
    return home ? g.score[0]! - g.score[1]! : g.score[1]! - g.score[0]!; };
  const b = roster(t); const m0 = run(b), m1 = run(treat(b)); d.push(m1 - m0); w.push(Math.sign(m1) - Math.sign(m0)); });
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length; const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
console.log(JSON.stringify({ pos: POS, slot: SLOT, delta: DELTA, talent: TALENT, n: d.length, dMargin: +mean(d).toFixed(3), seMargin: +(sd(d) / Math.sqrt(d.length)).toFixed(3), dWinPct: +(50 * mean(w)).toFixed(2), seWinPct: +(50 * sd(w) / Math.sqrt(d.length)).toFixed(2) }));
