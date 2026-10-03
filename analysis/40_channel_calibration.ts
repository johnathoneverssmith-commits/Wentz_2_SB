/**
 * Fits the league offsets in `src/engine/sim.ts` (`CALIB_BY_TALENT`), one
 * channel at a time, each to its own NFL rate.
 *
 *   npx tsx analysis/40_channel_calibration.ts [--talent 1.5] [--iters 4] [--seeds 1]
 *
 * Every ordered pair of the 32 real rosters, rating layer on, injuries on,
 * NFL overtime — the franchise game's options. Each iteration moves each
 * offset by the gap between the engine's rate and the real one (on the logit
 * scale for the rate channels, in yards for the run game), so the four
 * converge together; points per team-game is reported, not fitted — it
 * follows from the rates, and each league's scoring committee owns the rest.
 *
 * Targets: `artifacts/validation/simulation_validation.json`, empirical,
 * 2018-2025.
 */
import { readFileSync } from "node:fs";

import { roster, teamList } from "../src/engine/roster.js";
import { offenseCalibrationFor, setOffenseCalibration, simulateGame } from "../src/engine/sim.js";

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};
const TALENT = Number(arg("talent", "1.5"));
const ITERS = Number(arg("iters", "4"));
const SEEDS = Number(arg("seeds", "1"));
// --fit rates: every channel to its own rate. --fit points (the default):
// sacks and interceptions to their rates, and one shared nudge on completions
// and the run game (1 : 1.5, the old calibration's ratio) to the league's
// scoring — the engine's red zone runs short of the NFL's, so with all four
// rates exact a game scores ~20 rather than 22.6, and every league's scoring
// committee would spend seasons pushing completions back up to find it.
const FIT = arg("fit", "points");

const real = JSON.parse(readFileSync("artifacts/validation/simulation_validation.json", "utf8")).empirical_raw;
const target = {
  cmp: real.rates.completion_pct as number,
  int: real.rates.int_rate_per_att as number,
  sack: real.rates.sack_rate_per_dropback as number,
  ypc: real.rates.yards_per_carry as number,
  pts: real.per_game.points_per_team_game as number,
};
const logit = (p: number) => Math.log(p / (1 - p));

const teams = teamList();
function measure(): { cmp: number; int: number; sack: number; ypc: number; pts: number } {
  const t = { att: 0, cmp: 0, int: 0, sack: 0, ruA: 0, ruY: 0, pts: 0, g: 0 };
  let k = 0;
  for (let s = 0; s < SEEDS; s++) {
    for (const h of teams) {
      for (const a of teams) {
        if (h === a) continue;
        const g = simulateGame(7000 + k++, h, a, {
          homeRoster: roster(h),
          awayRoster: roster(a),
          injuries: true,
          talentScale: TALENT,
          overtime: "nfl",
        });
        t.pts += g.score[0] + g.score[1];
        t.g += 2;
        for (const side of [0, 1]) {
          const st = g.teams[side]!.s as Record<string, number>;
          t.att += st.pass_att ?? 0;
          t.cmp += st.completion ?? 0;
          t.int += st.int_thrown ?? 0;
          t.sack += st.sack ?? 0;
          t.ruA += st.rush_att ?? 0;
          t.ruY += st.rush_yards ?? 0;
        }
      }
    }
  }
  return {
    cmp: t.cmp / t.att,
    int: t.int / t.att,
    sack: t.sack / (t.att + t.sack),
    ypc: t.ruY / t.ruA,
    pts: t.pts / t.g,
  };
}

const c = { ...offenseCalibrationFor(TALENT) };
console.log(`talent ${TALENT}, start ${JSON.stringify(c)}`);
for (let it = 0; it <= ITERS; it++) {
  setOffenseCalibration(c);
  const m = measure();
  console.log(
    `iter ${it}: cmp ${(100 * m.cmp).toFixed(2)} (${(100 * target.cmp).toFixed(2)})  int ${(100 * m.int).toFixed(3)} (${(100 * target.int).toFixed(3)})  ` +
      `sack ${(100 * m.sack).toFixed(2)} (${(100 * target.sack).toFixed(2)})  ypc ${m.ypc.toFixed(3)} (${target.ypc.toFixed(3)})  pts ${m.pts.toFixed(2)} (${target.pts.toFixed(2)})`,
  );
  if (it === ITERS) break;
  c.interception += logit(target.int) - logit(m.int);
  c.sack += logit(target.sack) - logit(m.sack);
  if (FIT === "rates") {
    c.complete += logit(target.cmp) - logit(m.cmp);
    c.rushYards += target.ypc - m.ypc;
  } else {
    // ~10 points a team-game per unit of completion log-odds (with the run
    // game moving 1.5x alongside), measured from the first fits
    const step = (target.pts - m.pts) * 0.08;
    c.complete += step;
    c.rushYards += step * 1.5;
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  console.log(`  -> complete ${r(c.complete)} interception ${r(c.interception)} sack ${r(c.sack)} rushYards ${r(c.rushYards)}`);
}
