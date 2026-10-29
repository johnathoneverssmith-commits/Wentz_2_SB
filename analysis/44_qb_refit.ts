/**
 * Refit of the league passing means for the scaled quarterback effect (`setQbEffect`, `QB_REFIT` in sim.ts).
 *
 *   npx tsx analysis/44_qb_refit.ts --talent 1 [--iters 3] [--seeds 2] [--qb '{"complete":0.5,"interception":0.45,"arm":0.25}']
 *
 * Plays every ordered pair of the 32 reference rosters twice per seed with the effect OFF to get the target means
 * (completion %, interception %), then with it ON, nudging the two offsets by the logit gap until they match. Prints
 * the offsets to paste into `QB_REFIT`, and the passing line before and after. Franchise options (staff, weather,
 * injuries, NFL overtime). League-average only: it fixes the level, not the spread.
 */
import { roster, teamList } from "../src/engine/roster.js";
import { QB_REFIT, simulateGame } from "../src/engine/sim.js";
import { setQbEffect } from "../src/engine/ratings.js";
import { teamStaff } from "../src/engine/staff-data.js";
import { gameWeather } from "../src/engine/weather.js";

const arg = (n: string, d: string): string => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1]! : d;
};
const TALENT = Number(arg("talent", "1"));
const ITERS = Number(arg("iters", "3"));
const SEEDS = Number(arg("seeds", "2"));
const QB = JSON.parse(arg("qb", '{"complete":0.5,"interception":0.45,"arm":0.25}'));
const teams = teamList();

function measure(): { cmp: number; int: number; ypa: number; td: number; pts: number; sack: number } {
  const t = { att: 0, cmp: 0, int: 0, yds: 0, td: 0, pts: 0, sack: 0, tg: 0 };
  let k = 0;
  for (let s = 0; s < SEEDS; s++)
    for (const h of teams)
      for (const a of teams) {
        if (h === a) continue;
        const seed = 20_000 + k++;
        const g = simulateGame(seed, h, a, {
          homeRoster: roster(h), awayRoster: roster(a), trace: true, injuries: true, talentScale: TALENT, overtime: "nfl",
          weather: gameWeather(h, 1 + (k % 17), seed), homeStaff: teamStaff(h)!, awayStaff: teamStaff(a)!,
        });
        for (const side of [0, 1]) {
          const st = g.teams[side]!.s as Record<string, number>;
          t.att += st.pass_att ?? 0; t.cmp += st.completion ?? 0; t.int += st.int_thrown ?? 0; t.yds += st.pass_yards ?? 0; t.sack += st.sack ?? 0;
          t.pts += g.score[side]!; t.tg++;
        }
        for (const p of g.playTrace!) if (p.call === "pass" && p.touchdown) t.td++;
      }
  return { cmp: t.cmp / t.att, int: t.int / t.att, ypa: t.yds / t.att, td: t.td / t.tg, pts: t.pts / t.tg, sack: t.sack / (t.att + t.sack) };
}
const logit = (p: number) => Math.log(p / (1 - p));
const row = (n: string, m: ReturnType<typeof measure>) =>
  console.log(`${n.padEnd(22)} cmp ${(100 * m.cmp).toFixed(2)}%  int ${(100 * m.int).toFixed(3)}%  Y/A ${m.ypa.toFixed(3)}  pass TD/tg ${m.td.toFixed(3)}  sack ${(100 * m.sack).toFixed(2)}%  pts ${m.pts.toFixed(2)}`);

setQbEffect(null);
const target = measure();
row(`talent ${TALENT} effect off`, target);
const slot = QB_REFIT.find(([t]) => t === TALENT);
if (!slot) throw new Error("talent must be one of the QB_REFIT rows (1, 1.5, 2)");
slot[1].complete = 0;
slot[1].interception = 0;
setQbEffect(QB);
row("effect on, no refit", measure());
for (let i = 0; i < ITERS; i++) {
  const m = measure();
  slot[1].complete += logit(target.cmp) - logit(m.cmp);
  slot[1].interception += logit(target.int) - logit(m.int);
  setQbEffect(QB); // drop the Game-level caches the previous offsets sat in
  console.log(`iter ${i + 1}: complete ${slot[1].complete.toFixed(4)}  interception ${slot[1].interception.toFixed(4)}`);
}
row("effect on, refit", measure());
console.log(`QB_REFIT [${TALENT}, { complete: ${slot[1].complete.toFixed(3)}, interception: ${slot[1].interception.toFixed(3)} }]`);
