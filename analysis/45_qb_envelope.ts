/**
 * Quarterback statistical envelope, league level, for the scaled quarterback effect.
 *
 *   npx tsx analysis/45_qb_envelope.ts [--rosters fixed|<file.json[:snapshot]>] [--seasons 2] [--talent 1] [--qb off|on|'{"complete":..}']
 *
 * Plays full 17-game schedules (franchise options) and reports, over starters with 300+ attempts: completion %,
 * interception %, yards per attempt and passing touchdowns per season, their spread, extremes, and the league's means,
 * against the NFL 2023-25 figures (n=81 starters; nflverse). The mature-league snapshot files are the ones
 * `audit/realism-2026-10/mature_league.test.ts.txt` writes ({ snapshots: { "<season>": { TEAM: Player[] } } }).
 */
import { readFileSync } from "node:fs";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { Roster, roster } from "../src/engine/roster.js";
import { setQbEffect } from "../src/engine/ratings.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { simulateGame } from "../src/engine/sim.js";
import { teamStaff } from "../src/engine/staff-data.js";
import { weatherFor } from "../src/engine/weather.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const SRC = arg("rosters", "fixed");
const SEASONS = Number(arg("seasons", "2"));
const TALENT = Number(arg("talent", "1"));
const qbArg = arg("qb", "off");
setQbEffect(qbArg === "off" ? null : qbArg === "on" ? { complete: 0.5, interception: 0.45, arm: 0.25 } : JSON.parse(qbArg));

const rosters: Record<string, Roster> = {};
if (SRC === "fixed") for (const t of NFL_TEAMS) rosters[t] = roster(t);
else {
  const [f, snap] = SRC.split(":");
  const d = JSON.parse(readFileSync(f!, "utf8"));
  const teams = snap ? d.snapshots[snap] : d.teams;
  for (const t of NFL_TEAMS) rosters[t] = new Roster(t, teams[t]);
}
const sch = nflSchedule({ year: 2026 });
const qbs: { ovr: number; att: number; cmp: number; yds: number; td: number; int: number }[] = [];
const lg = { att: 0, cmp: 0, int: 0, yds: 0, td: 0, tg: 0, pts: 0, sack: 0 };
const margins: number[] = [];
for (let s = 0; s < SEASONS; s++) {
  const line: Record<string, (typeof qbs)[number]> = {};
  sch.forEach((sc, i) => {
    const gs = 515_000 + s * 10_000 + i;
    const g = simulateGame(gs, sc.home, sc.away, {
      homeRoster: rosters[sc.home]!, awayRoster: rosters[sc.away]!, trace: true, injuries: true, talentScale: TALENT, overtime: "nfl",
      weather: weatherFor(sc.home, "REG", sc.week, gs), homeStaff: teamStaff(sc.home)!, awayStaff: teamStaff(sc.away)!,
    });
    margins.push(g.score[0] - g.score[1]);
    for (const side of [0, 1]) {
      const st = g.teams[side]!.s as Record<string, number>;
      lg.att += st.pass_att ?? 0; lg.cmp += st.completion ?? 0; lg.int += st.int_thrown ?? 0; lg.yds += st.pass_yards ?? 0; lg.sack += st.sack ?? 0; lg.pts += g.score[side]!; lg.tg++;
    }
    const teams = [sc.home, sc.away];
    const ovr = (t: string, n: string) => [...rosters[t]!.depth.values()].flat().find((p) => p.name === n)?.overall ?? 0;
    for (const p of g.playTrace!) {
      if (p.call !== "pass" || !p.passer) continue;
      const t = teams[p.team]!;
      const l = (line[`${t}|${p.passer}`] ??= { ovr: ovr(t, p.passer), att: 0, cmp: 0, yds: 0, td: 0, int: 0 });
      l.att++;
      if (p.outcome === "complete") { l.cmp++; l.yds += Math.round(p.gained); if (p.touchdown) { l.td++; lg.td++; } } else if (p.outcome === "interception") l.int++;
    }
  });
  qbs.push(...Object.values(line).filter((l) => l.att >= 300));
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(a.reduce((n, x) => n + (x - m) ** 2, 0) / a.length); };
const c = qbs.map((q) => (100 * q.cmp) / q.att), i = qbs.map((q) => (100 * q.int) / q.att), y = qbs.map((q) => q.yds / q.att);
const tdS = qbs.map((q) => (q.td / q.att) * 560), intS = qbs.map((q) => (q.int / q.att) * 560);
const fmt = (a: number[]) => `${mean(a).toFixed(2)} sd ${sd(a).toFixed(2)} (${Math.min(...a).toFixed(2)}-${Math.max(...a).toFixed(2)})`;
const slope = (x: number[], z: number[]) => { const mx = mean(x), mz = mean(z); return (x.reduce((n, v, k) => n + (v - mx) * (z[k]! - mz), 0) / x.reduce((n, v) => n + (v - mx) ** 2, 0)) * 10; };
const ovr = qbs.map((q) => q.ovr);
console.log(`rosters ${SRC} talent ${TALENT} qb ${qbArg}: ${SEASONS} seasons, ${qbs.length} starter-seasons, ${margins.length} games`);
console.log(`  completion %      ${fmt(c)}      NFL 65.6 sd 3.09 (58.1-72.9)`);
console.log(`  interception %    ${fmt(i)}      NFL 2.06 sd 0.71 (0.60-3.99)`);
console.log(`  yards / attempt   ${fmt(y)}      NFL 7.24 sd 0.76 (5.46-9.64)`);
console.log(`  pass TD / 560 att ${fmt(tdS)}      NFL mean 21.0, max 46`);
console.log(`  INT / 560 att     ${fmt(intS)}      NFL mean 9.1, max 21`);
console.log(`  per +10 QB overall: cmp ${slope(ovr, c).toFixed(2)}  int ${slope(ovr, i).toFixed(2)}  Y/A ${slope(ovr, y).toFixed(2)}  TD/560 ${slope(ovr, tdS).toFixed(2)}`);
console.log(`  league: cmp ${((100 * lg.cmp) / lg.att).toFixed(2)}%  int ${((100 * lg.int) / lg.att).toFixed(3)}%  Y/A ${(lg.yds / lg.att).toFixed(3)}  pass TD/tg ${(lg.td / lg.tg).toFixed(3)}  sack ${((100 * lg.sack) / (lg.att + lg.sack)).toFixed(2)}%  pts/tg ${(lg.pts / lg.tg).toFixed(2)}  margin sd ${sd(margins).toFixed(2)}`);
