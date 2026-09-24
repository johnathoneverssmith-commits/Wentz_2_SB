import type { GameResult, LeagueState } from "@/domain";

/**
 * Keeping a long dynasty inside the browser's storage.
 *
 * A single-player league lives in localStorage, which holds about five
 * million characters per site. A ten-season league measured ~3.1 million
 * before the current season's box scores, and every game's player lines add
 * ~1.5 million more by the end of a season — a decade in, a save was one
 * season from failing to write. Three things in it are dead weight.
 */

/**
 * Player lines only where someone will open them.
 *
 * Season stats are accrued from a slate's lines before this runs, so a game
 * no human played in keeps its team totals and scoring summary and drops the
 * forty-odd player lines. Online has always done this (the league document
 * travels on every action); locally it is the same data for the same reason.
 */
export function trimStoredBoxScores(results: GameResult[], humanTeams: ReadonlySet<string>): void {
  for (const g of results) {
    if (humanTeams.has(g.homeTeam) || humanTeams.has(g.awayTeam)) continue;
    delete g.playerLines;
  }
}

export function humanTeamsOf(s: Pick<LeagueState, "gms">): Set<string> {
  return new Set(s.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
}

/** How many injuries a player's history keeps — plenty for "injury-prone". */
export const INJURY_HISTORY_KEPT = 12;

/**
 * A retired player keeps who he was, not everything he was made of.
 *
 * Name, position, final rating, team and retirement season stay — they are
 * what history screens show. His forty skill ratings, injury log and last
 * season's stat line go: nothing reads them once he has left the league, and
 * eight hundred retirees carrying them were a sixth of the save.
 */
export function compactRetired(s: LeagueState): void {
  for (const p of Object.values(s.players)) {
    if (!p.retired) continue;
    if (Object.keys(p.attributes).length) p.attributes = {};
    if (p.injury_history.length) p.injury_history = [];
    if (p.season_stats) delete p.season_stats;
  }
}
