import { extractBoxScore } from "../../src/engine/boxscore.js";
import type { Game } from "../../src/engine/sim.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";
import { playerLinesFrom, quarterScores, scoringPlaysFrom, toTeamTotals } from "../../server/boxscore-map.js";

import type { GameResult, Player } from "@/domain";

/**
 * The box score of one online game, in the shapes the stats screens read.
 *
 * The local engine adapter has always built these (`server/index.ts`); the
 * online server simulated the same games and threw the trace away, so an
 * online league had no team totals, no scoring summary and no player lines —
 * which left Player Statistics, League Stats and every leaderboard empty for
 * the whole season. Same mapping as the adapter, so the two agree.
 */
export function boxScoreOf(
  sim: Game,
  home: string,
  away: string,
  week: number,
  squads: { home: readonly Player[]; away: readonly Player[] },
): Pick<GameResult, "totals" | "scoringPlays" | "playerLines"> {
  const trace = sim.playTrace ?? [];
  const box = extractBoxScore(sim, home, away, week);
  const final: [number, number] = [sim.score[0], sim.score[1]];
  const byQuarter = quarterScores(trace, final, sim.drivesLog);
  return {
    totals: {
      home: toTeamTotals(box.home, byQuarter[0]!, sim.drivesLog.filter((d) => d.team === 0)),
      away: toTeamTotals(box.away, byQuarter[1]!, sim.drivesLog.filter((d) => d.team === 1)),
    },
    scoringPlays: scoringPlaysFrom(trace, home, away, final, sim.drivesLog),
    // positions come off the franchise's own players, so they are the UI's
    playerLines: playerLinesFrom(trace, home, away, {
      [home]: squads.home as unknown as EnginePlayer[],
      [away]: squads.away as unknown as EnginePlayer[],
    }) as unknown as NonNullable<GameResult["playerLines"]>,
  };
}

/**
 * Keep the heavy parts only where someone will open them.
 *
 * The league document travels whole on every action and stream frame, and a
 * season of player lines for every game is over a megabyte. Season stats are
 * accrued from the lines before this runs, so a game no human played in
 * keeps its (small) team totals and nothing else; a human's games keep the
 * whole box score for the Game Day and box score screens.
 */
export function trimStoredBoxScores(results: GameResult[], humanTeams: ReadonlySet<string>): void {
  for (const g of results) {
    if (humanTeams.has(g.homeTeam) || humanTeams.has(g.awayTeam)) continue;
    delete g.playerLines;
    delete g.scoringPlays;
  }
}
