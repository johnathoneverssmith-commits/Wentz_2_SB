/**
 * Scratch: points_sd with the rating layer ON — real rosters, real spread.
 *
 * §22 runs two identical average teams on purpose, which removes team-quality
 * spread, which is a large share of real scoring variance. The question is
 * what the engine does when that spread is present.
 */
import { simulateGame } from "../src/engine/sim.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";

const N = Number(process.argv[2] ?? 400);
const pts: number[] = [];
const codes = [...NFL_TEAMS];

let n = 0;
for (let i = 0; n < N; i++) {
  const home = codes[i % codes.length]!;
  const away = codes[(i * 7 + 3) % codes.length]!;
  if (home === away) continue;
  const g = simulateGame(5000 + i, home, away);
  pts.push(g.score[0]!, g.score[1]!);
  n++;
}

const mean = pts.reduce((a, b) => a + b, 0) / pts.length;
const sd = Math.sqrt(pts.reduce((a, b) => a + (b - mean) ** 2, 0) / pts.length);
const p = (q: number) => [...pts].sort((a, b) => a - b)[Math.floor((pts.length * q) / 100)];
console.log(JSON.stringify({
  n_team_games: pts.length,
  mean: +mean.toFixed(2),
  sd: +sd.toFixed(2),
  real_mean: 22.56,
  real_sd: 9.93,
  rel_err_sd: +(((sd - 9.93) / 9.93) * 100).toFixed(1),
  percentiles: [5, 10, 25, 50, 75, 90, 95].map((q) => [q, p(q)]),
  share_under_10: +(pts.filter((x) => x < 10).length / pts.length).toFixed(3),
  share_over_30: +(pts.filter((x) => x > 30).length / pts.length).toFixed(3),
}, null, 1));
