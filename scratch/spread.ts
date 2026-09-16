/**
 * Scratch: how much does team quality actually move the scoreboard?
 *
 * Decomposes points variance into between-team and within-team. Real football
 * has a big between-team component: good offenses score more than bad ones,
 * every week. If the engine's is near zero, the rating layer is under-powered
 * and that — not a missing game-level form factor — is where points_sd went.
 */
import { simulateGame } from "../src/engine/sim.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { roster } from "../src/engine/roster.js";

const PER_TEAM = Number(process.argv[2] ?? 40);
const codes = [...NFL_TEAMS];
const byTeam = new Map<string, number[]>();
const all: number[] = [];

let seed = 90000;
for (const home of codes) {
  for (let k = 0; k < PER_TEAM; k++) {
    const away = codes[(codes.indexOf(home) + 1 + k) % codes.length]!;
    if (away === home) continue;
    const g = simulateGame(seed++, home, away);
    for (const [code, pts] of [[home, g.score[0]!], [away, g.score[1]!]] as const) {
      if (!byTeam.has(code)) byTeam.set(code, []);
      byTeam.get(code)!.push(pts);
      all.push(pts);
    }
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const vari = (xs: number[]) => {
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
};

const teamMeans = [...byTeam.entries()].map(([code, xs]) => ({ code, mean: mean(xs), n: xs.length }));
teamMeans.sort((a, b) => b.mean - a.mean);
const between = vari(teamMeans.map((t) => t.mean));
const within = mean([...byTeam.values()].map(vari));

// what the engine thinks each team is worth, for context
const ovr = (code: string): number => {
  const r = roster(code);
  const starters = (r as unknown as { players: { overall: number }[] }).players ?? [];
  return starters.length ? +(mean(starters.slice(0, 22).map((p) => p.overall))).toFixed(1) : 0;
};

console.log(JSON.stringify({
  team_games: all.length,
  overall: { mean: +mean(all).toFixed(2), sd: +Math.sqrt(vari(all)).toFixed(2) },
  between_team_sd: +Math.sqrt(between).toFixed(3),
  within_team_sd: +Math.sqrt(within).toFixed(3),
  best: teamMeans.slice(0, 3).map((t) => [t.code, +t.mean.toFixed(1), ovr(t.code)]),
  worst: teamMeans.slice(-3).map((t) => [t.code, +t.mean.toFixed(1), ovr(t.code)]),
  spread_best_minus_worst: +(teamMeans[0]!.mean - teamMeans[teamMeans.length - 1]!.mean).toFixed(2),
}, null, 1));
