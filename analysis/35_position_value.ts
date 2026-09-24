/**
 * What a rating point is worth at each position — in points, on this engine.
 *
 *   npx tsx analysis/35_position_value.ts [--seeds N]
 *
 * For each position group, a median reference team's starters there are set
 * to an *average* starter and then to an *elite* one, and the team plays
 * every other team home and away both ways. The difference in average
 * scoring margin, divided by the difference in the starters' overall, is
 * that position's value per rating point: what a GM should pay for.
 *
 * This is the measurement behind the Impossible AI's unit weights
 * (`ui-source/src/state/unitValue.ts`). Everything the engine rewards is in
 * it — the linear rating families, the team-strength index, and synergy —
 * because it measures the result rather than any one mechanism.
 */

import type { Player } from "../src/schema/player.js";
import { loadPool, Roster, roster, teamList, type DepthOrder } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const i = process.argv.indexOf("--seeds");
const SEEDS = i >= 0 ? Number(process.argv[i + 1]) : 2;

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const everyone: Player[] = [...loadPool().values()].flat();
let n = 0;
const clone = (p: Player): Player => ({ ...p, id: `${p.id}__pv${n++}` });

/** Who starts where, per team: the reference depth charts. */
const starterCount: Record<string, number> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, OLB: 2, CB: 2, S: 2, K: 1, P: 1,
};

/** Starters across the league at a position, best first. */
function startersAt(pos: string): Player[] {
  const out: Player[] = [];
  for (const t of teamList()) {
    const list = (roster(t).depth.get(pos) ?? []).slice(0, starterCount[pos] ?? 1);
    out.push(...list);
  }
  return out.sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
}

function median(): string {
  const mean = (t: string) => {
    const ps = [...Object.values(roster(t).offense()), ...Object.values(roster(t).defense())].filter((p): p is Player => !!p);
    return ps.reduce((a, p) => a + (p.overall ?? 0), 0) / ps.length;
  };
  const r = teamList().map((t) => ({ t, m: mean(t) })).sort((a, b) => a.m - b.m);
  return r[Math.floor(r.length / 2)]!.t;
}

function variant(base: string, pos: string, starters: Player[]): Roster {
  const players = [...loadPool().get(base)!];
  const c = starters.map(clone);
  players.push(...c);
  return new Roster(base, players, { [pos]: c.map((p) => p.id) } as DepthOrder);
}

function marginOf(r: Roster, base: string): number {
  let m = 0;
  let g = 0;
  for (const opp of teamList()) {
    if (opp === base) continue;
    for (let k = 0; k < SEEDS; k++) {
      for (const home of [true, false]) {
        const seed = hash(`PV|${opp}|${k}|${home}`);
        const game = home
          ? simulateGame(seed, base, opp, { homeRoster: r, awayRoster: roster(opp) })
          : simulateGame(seed, opp, base, { homeRoster: roster(opp), awayRoster: r });
        m += home ? game.score[0] - game.score[1] : game.score[1] - game.score[0];
        g++;
      }
    }
  }
  return m / g;
}

const base = median();
console.log(`median team ${base}, ${SEEDS * 2 * 31} games a cell\n`);
console.log("pos    avg OVR  elite OVR   margin avg  margin elite   pts / rating pt / starter");
const rows: [string, number][] = [];
for (const pos of Object.keys(starterCount)) {
  const k = starterCount[pos]!;
  const pool = startersAt(pos);
  if (pool.length < k * 2) continue;
  const mid = Math.floor(pool.length / 2);
  const avg = pool.slice(mid - Math.floor(k / 2), mid - Math.floor(k / 2) + k);
  const elite = pool.slice(0, k);
  const ovr = (ps: Player[]) => ps.reduce((a, p) => a + (p.overall ?? 0), 0) / ps.length;
  const mAvg = marginOf(variant(base, pos, avg), base);
  const mElite = marginOf(variant(base, pos, elite), base);
  const perPoint = (mElite - mAvg) / (ovr(elite) - ovr(avg)) / k;
  rows.push([pos, perPoint]);
  console.log(
    `${pos.padEnd(6)} ${ovr(avg).toFixed(1).padStart(7)} ${ovr(elite).toFixed(1).padStart(10)} ${mAvg.toFixed(2).padStart(12)} ${mElite.toFixed(2).padStart(13)} ${perPoint.toFixed(3).padStart(14)}`,
  );
}
console.log("\nranked:", rows.sort((a, b) => b[1] - a[1]).map(([p, v]) => `${p} ${v.toFixed(3)}`).join("  "));
