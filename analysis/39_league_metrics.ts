/**
 * The validated league aggregates, on the franchise game's options.
 *
 *   npx tsx analysis/39_league_metrics.ts [--seeds N] [--talent T]
 *
 * Every ordered pair of the 32 real rosters (rating layer, team strength,
 * synergy and injuries on), reported against the NFL's 2018-2025 numbers in
 * `artifacts/validation/simulation_validation.json` and the spread targets
 * the team-strength fit used (margin sd 14.33, favourite win rate 66–70%).
 *
 * The check for any change to how units affect a play: averages are centred
 * on the reference rosters and must not move; the spread may only move toward
 * the real figures.
 */
import { readFileSync } from "node:fs";

import { roster, teamList } from "../src/engine/roster.js";
import { setOffenseCalibration, simulateGame } from "../src/engine/sim.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const SEEDS = Number(arg("seeds", "2"));
const TALENT = Number(arg("talent", "1"));
// --calib '{"complete":0,"rushYards":-0.16,"sack":-0.26,"interception":-0.41}' to try offsets
if (process.argv.includes("--calib")) setOffenseCalibration(JSON.parse(arg("calib", "{}")));

const empirical = JSON.parse(readFileSync("artifacts/validation/simulation_validation.json", "utf8")).empirical_raw;

const teams = teamList();
const ovr = (t: string) => {
  const r = roster(t);
  const ps = [...Object.values(r.offense()), ...Object.values(r.defense())].filter((p) => !!p) as { overall?: number }[];
  return ps.reduce((a, p) => a + (p.overall ?? 0), 0) / ps.length;
};
const rating = new Map(teams.map((t) => [t, ovr(t)]));

const pts: number[] = [];
const margins: number[] = [];
let favWins = 0;
let favGames = 0;
const tot = { att: 0, cmp: 0, int: 0, sack: 0, ruA: 0, ruY: 0, py: 0, xp: 0, xr: 0, rzT: 0, rzD: 0, drv: 0, td: 0, fg: 0, plays: 0 };
let k = 0;
for (let s = 0; s < SEEDS; s++) {
  for (const h of teams) {
    for (const a of teams) {
      if (h === a) continue;
      const g = simulateGame(5000 + k++, h, a, {
        homeRoster: roster(h),
        awayRoster: roster(a),
        injuries: true,
        talentScale: TALENT,
        overtime: "nfl",
      });
      pts.push(g.score[0], g.score[1]);
      margins.push(g.score[0] - g.score[1]);
      const fav = rating.get(h)! >= rating.get(a)! ? 0 : 1;
      if (g.score[0] !== g.score[1]) {
        favGames++;
        if ((g.score[0] > g.score[1] ? 0 : 1) === fav) favWins++;
      }
      for (const side of [0, 1]) {
        const st = g.teams[side]!.s as Record<string, number>;
        tot.att += st.pass_att ?? 0;
        tot.cmp += st.completion ?? 0;
        tot.int += st.int_thrown ?? 0;
        tot.sack += st.sack ?? 0;
        tot.ruA += st.rush_att ?? 0;
        tot.ruY += st.rush_yards ?? 0;
        tot.py += st.pass_yards ?? 0;
        tot.xp += st.explosive_pass ?? 0;
        tot.xr += st.explosive_rush ?? 0;
        tot.rzT += st.rz_trip ?? 0;
        tot.rzD += st.rz_td ?? 0;
        tot.drv += st.drives ?? 0;
        tot.td += st.td ?? 0;
        tot.fg += st.fg_made ?? 0;
      }
    }
  }
}
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const sd = (x: number[]) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / x.length);
};

const rows: [string, number, number | string][] = [
  ["points per team-game", mean(pts), empirical.per_game.points_per_team_game],
  ["points sd", sd(pts), empirical.per_game.points_sd],
  ["margin sd", sd(margins), 14.33],
  ["favourite win %", (100 * favWins) / favGames, "66-70"],
  ["completion %", (100 * tot.cmp) / tot.att, 100 * empirical.rates.completion_pct],
  ["int % per att", (100 * tot.int) / tot.att, 100 * empirical.rates.int_rate_per_att],
  ["sack % per dropback", (100 * tot.sack) / (tot.att + tot.sack), 100 * empirical.rates.sack_rate_per_dropback],
  ["yards per carry", tot.ruY / tot.ruA, empirical.rates.yards_per_carry],
  ["yards per pass att", tot.py / tot.att, empirical.rates.yards_per_attempt],
  ["explosive pass rate", tot.xp / tot.att, empirical.rates.explosive_pass_rate],
  ["explosive rush rate", tot.xr / tot.ruA, empirical.rates.explosive_rush_rate],
  ["red zone TD rate", tot.rzD / tot.rzT, empirical.rates.rz_td_rate],
  ["drives per team-game", tot.drv / pts.length, empirical.per_game.drives_per_team_game],
  ["TDs per team-game", tot.td / pts.length, "-"],
  ["FGs per team-game", tot.fg / pts.length, "-"],
];
console.log(`${margins.length} games, talent ${TALENT}\n`);
console.log("metric                    engine     real    rel err");
for (const [name, v, real] of rows) {
  const rel = typeof real === "number" ? `${(((v - real) / real) * 100).toFixed(1)}%` : "";
  console.log(`${name.padEnd(24)} ${v.toFixed(3).padStart(8)} ${String(typeof real === "number" ? real.toFixed(3) : real).padStart(8)}   ${rel}`);
}
