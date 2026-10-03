/**
 * What each unit does on the field — and to the units around it.
 *
 *   npx tsx analysis/38_unit_links.ts [--seeds N] [--talent T]
 *
 * A median reference team has one unit at a time swapped for elite starters
 * (the best at those positions across the league), then plays every other
 * team home and away on the *same* seeds as the unchanged team. The
 * difference is what that unit is worth, read two ways:
 *
 *  - in points: scoring margin, and points for / against
 *  - in the statistics it should move: opponent completion %, interceptions
 *    per attempt, sacks per dropback, yards per carry — and the ones it
 *    should move *through other units* (a pass rush that makes the secondary
 *    look better, a secondary that buys the rush time)
 *
 * Common random numbers keep the comparison tight: every variant faces the
 * same opponents on the same seeds, so most of the game-to-game noise cancels
 * in the difference.
 */

import type { Player } from "../src/schema/player.js";
import { loadPool, Roster, roster, teamList, type DepthOrder } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const SEEDS = Number(arg("seeds", "4"));
const TALENT = Number(arg("talent", "1"));

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const starterCount: Record<string, number> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, CB: 2, S: 2,
};

function startersAt(pos: string): Player[] {
  const out: Player[] = [];
  for (const t of teamList()) out.push(...(roster(t).depth.get(pos) ?? []).slice(0, starterCount[pos] ?? 1));
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

let n = 0;
const clone = (p: Player): Player => ({ ...p, id: `${p.id}__ul${n++}` });

/** The base roster with each listed position's starters replaced by elite ones. */
function eliteAt(base: string, positions: string[]): Roster {
  const players = [...loadPool().get(base)!];
  const order: Record<string, string[]> = {};
  for (const pos of positions) {
    const k = starterCount[pos] ?? 1;
    const c = startersAt(pos).slice(0, k).map(clone);
    players.push(...c);
    order[pos] = c.map((p) => p.id);
  }
  return new Roster(base, players, order as DepthOrder);
}

interface Line {
  margin: number;
  pf: number;
  pa: number;
  // the variant's defense, i.e. what its opponents managed
  oppCmp: number;
  oppInt: number;
  oppSack: number;
  oppYpc: number;
  // the variant's own offense
  cmp: number;
  int: number;
  sack: number;
  ypc: number;
}

function play(r: Roster, base: string): Line {
  const t = { margin: 0, pf: 0, pa: 0, oAtt: 0, oCmp: 0, oInt: 0, oSack: 0, oRuA: 0, oRuY: 0, att: 0, cmpd: 0, int: 0, sack: 0, ruA: 0, ruY: 0, g: 0 };
  for (const opp of teamList()) {
    if (opp === base) continue;
    for (let k = 0; k < SEEDS; k++) {
      for (const home of [true, false]) {
        const seed = hash(`UL|${opp}|${k}|${home}`);
        const g = home
          ? simulateGame(seed, base, opp, { homeRoster: r, awayRoster: roster(opp), talentScale: TALENT })
          : simulateGame(seed, opp, base, { homeRoster: roster(opp), awayRoster: r, talentScale: TALENT });
        const me = home ? 0 : 1;
        const them = 1 - me;
        const s = (side: number, key: string) => (g.teams[side]!.s as Record<string, number>)[key] ?? 0;
        t.pf += g.score[me]!;
        t.pa += g.score[them]!;
        t.margin += g.score[me]! - g.score[them]!;
        t.oAtt += s(them, "pass_att");
        t.oCmp += s(them, "completion");
        t.oInt += s(them, "int_thrown");
        t.oSack += s(them, "sack");
        t.oRuA += s(them, "rush_att");
        t.oRuY += s(them, "rush_yards");
        t.att += s(me, "pass_att");
        t.cmpd += s(me, "completion");
        t.int += s(me, "int_thrown");
        t.sack += s(me, "sack");
        t.ruA += s(me, "rush_att");
        t.ruY += s(me, "rush_yards");
        t.g++;
      }
    }
  }
  return {
    margin: t.margin / t.g,
    pf: t.pf / t.g,
    pa: t.pa / t.g,
    oppCmp: (100 * t.oCmp) / t.oAtt,
    oppInt: (100 * t.oInt) / t.oAtt,
    oppSack: (100 * t.oSack) / (t.oAtt + t.oSack),
    oppYpc: t.oRuY / t.oRuA,
    cmp: (100 * t.cmpd) / t.att,
    int: (100 * t.int) / t.att,
    sack: (100 * t.sack) / (t.att + t.sack),
    ypc: t.ruY / t.ruA,
  };
}

const UNITS: [string, string[]][] = [
  ["QB", ["QB"]],
  ["RB", ["RB"]],
  ["WR", ["WR"]],
  ["TE", ["TE"]],
  ["OL", ["OT", "OG", "C"]],
  ["DL", ["EDGE", "DT"]],
  ["EDGE", ["EDGE"]],
  ["DT", ["DT"]],
  ["LB", ["ILB"]],
  ["DB", ["CB", "S"]],
  ["CB", ["CB"]],
  ["S", ["S"]],
];

const base = median();
const games = (teamList().length - 1) * SEEDS * 2;
console.log(`median team ${base}, ${games} games a variant, talent ${TALENT}`);
const b = play(roster(base), base);
const f = (x: number, d = 2) => (x >= 0 ? "+" : "") + x.toFixed(d);
console.log(`\nbase: margin ${b.margin.toFixed(2)}  allowed cmp ${b.oppCmp.toFixed(1)}%  int ${b.oppInt.toFixed(2)}%  sack ${b.oppSack.toFixed(2)}%  ypc ${b.oppYpc.toFixed(2)}`);
console.log("\nunit   margin    PF      PA    | opp cmp  opp int  opp sack  opp ypc | own cmp  own int  own sack  own ypc");
const rows: Record<string, Line> = {};
for (const [name, positions] of UNITS) {
  const v = play(eliteAt(base, positions), base);
  rows[name] = v;
  console.log(
    `${name.padEnd(5)} ${f(v.margin - b.margin).padStart(6)} ${f(v.pf - b.pf).padStart(6)} ${f(v.pa - b.pa).padStart(6)}   | ` +
      `${f(v.oppCmp - b.oppCmp, 1).padStart(6)}  ${f(v.oppInt - b.oppInt).padStart(6)}  ${f(v.oppSack - b.oppSack).padStart(7)}  ${f(v.oppYpc - b.oppYpc).padStart(6)} | ` +
      `${f(v.cmp - b.cmp, 1).padStart(6)}  ${f(v.int - b.int).padStart(6)}  ${f(v.sack - b.sack).padStart(7)}  ${f(v.ypc - b.ypc).padStart(6)}`,
  );
}
const off = ["QB", "RB", "WR", "TE", "OL"].reduce((a, k) => a + rows[k]!.margin - b.margin, 0);
const def = ["DL", "LB", "DB"].reduce((a, k) => a + rows[k]!.margin - b.margin, 0);
console.log(`\nsum of unit margins: offense ${f(off)}  defense ${f(def)}  defense/offense ${(def / off).toFixed(2)}`);
