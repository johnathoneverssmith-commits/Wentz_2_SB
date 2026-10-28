import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { Roster } from "../../src/engine/roster.js";
import { simulateGame } from "../../src/engine/sim.js";
import { presentGame } from "../../server/simGame.js";
import type { Player } from "../../src/schema/player.js";
import { boxScoreOf } from "../src/boxscore.js";

/**
 * A single-player game is presented by the adapter (`server/simGame.ts`) and an
 * online one by `boxScoreOf`. They have always been meant to be the same
 * mapping; with the engine's score log feeding both, the scoring summary and
 * the line score must come out identical for the same simulated game.
 */
const pool = JSON.parse(readFileSync(new URL("../../ui-source/src/data/pool-2026.json", import.meta.url), "utf8")) as Player[];
const squad = (team: string): Player[] => pool.filter((p) => p.nfl_team === team);

describe("single-player and online present the same game the same way", () => {
  it("scoring summary and line score agree, overtime included", () => {
    const pairs: [string, string][] = [["KC", "BUF"], ["SF", "DAL"], ["PHI", "DET"]];
    let games = 0;
    for (let seed = 1; seed <= 12; seed++)
      for (const [home, away] of pairs) {
        const g = simulateGame(seed, home, away, {
          homeRoster: new Roster(home, squad(home)),
          awayRoster: new Roster(away, squad(away)),
          trace: true,
          injuries: true,
          overtime: "nfl",
        });
        const local = presentGame(g, { homeTeam: home, awayTeam: away, week: 1, weather: null });
        const online = boxScoreOf(g, home, away, 1, { home: [], away: [] });
        const where = `${away}@${home} seed ${seed}`;
        expect(online.scoringPlays, where).toEqual(local.scoringPlays);
        expect(online.totals!.home.byQuarter, where).toEqual(local.totals.home.byQuarter);
        expect(online.totals!.away.byQuarter, where).toEqual(local.totals.away.byQuarter);
        const last = local.scoringPlays.at(-1);
        if (g.score[0] + g.score[1] > 0) expect([last!.homeScore, last!.awayScore], where).toEqual([g.score[0], g.score[1]]);
        games++;
      }
    expect(games).toBe(36);
  }, 120_000);
});
