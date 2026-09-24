/**
 * Fits the league-average offense calibration in `src/engine/sim.ts`.
 *
 * Plays every ordered pair of the 32 real rosters (one seed each, rating
 * layer on, injuries on, NFL overtime — the franchise game's options) at a
 * grid of completion / rush-yard offsets and reports points per team-game,
 * against the NFL's 22.56 over 2018-2025 (artifacts/validation/
 * simulation_validation.json, empirical).
 *
 *   npx tsx analysis/37_scoring_calibration.ts [--talent 1.5]
 */
import { roster, teamList } from "../src/engine/roster.js";
import { setOffenseCalibration, simulateGame } from "../src/engine/sim.js";

const talent = process.argv.includes("--talent") ? Number(process.argv[process.argv.indexOf("--talent") + 1]) : 1;
const grid: [number, number][] = process.argv.includes("--grid")
  ? JSON.parse(process.argv[process.argv.indexOf("--grid") + 1]!)
  : [[0, 0], [0.1, 0.15], [0.2, 0.3], [0.3, 0.45]];

const teams = teamList();
for (const [complete, rushYards] of grid) {
  setOffenseCalibration({ complete, rushYards });
  let pts = 0;
  let games = 0;
  let k = 0;
  for (const h of teams) {
    for (const a of teams) {
      if (h === a) continue;
      const g = simulateGame(1000 + k++, h, a, {
        homeRoster: roster(h),
        awayRoster: roster(a),
        injuries: true,
        talentScale: talent,
        overtime: "nfl",
      });
      pts += g.score[0] + g.score[1];
      games++;
    }
  }
  console.log(`complete ${complete.toFixed(2)} rushYards ${rushYards.toFixed(2)} -> ${(pts / games / 2).toFixed(2)} pts/team-game (${games} games)`);
}
