import { describe, expect, it } from "vitest";

import {
  playerLinesFrom,
  quarterScores,
  scoringPlaysFrom,
  toTeamTotals,
} from "../server/boxscore-map.js";
import { extractBoxScore } from "../src/engine/boxscore.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * The adapter turns a simulated game into the box score the franchise UI
 * shows. Two things have to hold for that to be trustworthy, and both are
 * easy to break: the line score and the scoring summary each have to add up
 * to the engine's own final score.
 *
 * They don't come for free. Extra points aren't traced plays, and a turnover
 * returned for a touchdown isn't either — the sim books it on the conceding
 * team's drive as `opp_touchdown`. Reconstructing naively loses 7 points a
 * pick-six and reports 8-0 for an opening touchdown.
 */
const SEEDS = [
  1, 3, 7, 13, 29, 44, 67, 101, 128, 199, 257, 313, 512, 777, 1009, 1234, 2048, 3141, 4242, 9001,
];
const PAIRS: [string, string][] = [
  ["KC", "BUF"],
  ["SF", "DAL"],
  ["PHI", "NYG"],
  ["GB", "CHI"],
];

describe("adapter box-score mapping", () => {
  it("line score and scoring summary both reconcile to the final score", () => {
    for (const seed of SEEDS) {
      for (const [home, away] of PAIRS) {
        const g = simulateGame(seed, home, away, { trace: true, injuries: true });
        const trace = g.playTrace ?? [];
        const final: [number, number] = [g.score[0], g.score[1]];
        const where = `${away}@${home} seed ${seed} (${final[0]}-${final[1]})`;

        const byQuarter = quarterScores(trace, final, g.drivesLog);
        expect(byQuarter[0]!.reduce((a, b) => a + b, 0), `home line score, ${where}`).toBe(final[0]);
        expect(byQuarter[1]!.reduce((a, b) => a + b, 0), `away line score, ${where}`).toBe(final[1]);

        const plays = scoringPlaysFrom(trace, home, away, final, g.drivesLog);
        const last = plays[plays.length - 1];
        if (final[0] + final[1] > 0) {
          expect(last, `a scored game needs a scoring summary, ${where}`).toBeDefined();
          expect(last!.homeScore, `summary home total, ${where}`).toBe(final[0]);
          expect(last!.awayScore, `summary away total, ${where}`).toBe(final[1]);
        }
        // the running score only ever climbs
        let prev = 0;
        for (const p of plays) {
          expect(p.homeScore + p.awayScore, `running score, ${where}`).toBeGreaterThanOrEqual(prev);
          prev = p.homeScore + p.awayScore;
        }
      }
    }
    // 80 simulated games: comfortably under a second each on its own, but it
    // shares the machine with the rest of the suite
  }, 120_000);

  it("team totals carry the engine's own counters", () => {
    const g = simulateGame(7, "KC", "BUF", { trace: true, injuries: true });
    const box = extractBoxScore(g, "KC", "BUF");
    const totals = toTeamTotals(box.home, [0, 0, 0, 0]);
    expect(totals.points).toBe(box.home.points);
    expect(totals.totalYards).toBe(box.home.passYards + box.home.rushYards);
    expect(totals.thirdDownAtt).toBe(box.home.thirdDown[1]);
    expect(totals.penaltyYards).toBe(box.home.penaltyYards);
    expect(totals.topSeconds).toBeGreaterThan(0);
  });

  it("player lines add up to the team's passing and rushing yards", () => {
    const g = simulateGame(29, "KC", "BUF", { trace: true, injuries: true });
    const lines = playerLinesFrom(g.playTrace ?? [], "KC", "BUF", undefined);
    const passYds = lines.home.reduce((n, l) => n + (l.passYds ?? 0), 0);
    const recYds = lines.home.reduce((n, l) => n + (l.recYds ?? 0), 0);
    // every completion credits a passer and a receiver the same yardage
    expect(recYds).toBe(passYds);
    expect(lines.home.length).toBeGreaterThan(0);
    expect(lines.away.length).toBeGreaterThan(0);
  });
});
