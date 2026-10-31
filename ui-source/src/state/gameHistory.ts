import type { ArchivedGame, GameResult, LeagueState } from "@/domain";
import { humanTeamsOf } from "./saveCompaction";

/**
 * Game history that outlives the season.
 *
 * `state.games` holds the current season only: the rollover empties it. That
 * made every game a GM had played unreachable the moment the next season
 * began — the box score and the play-by-play both look games up by id. So
 * before the clear, the games a human GM's team played are copied here.
 *
 * What is kept, and why it is bounded: a stored play-by-play is ~44KB and a
 * solo league lives in ~5MB of localStorage. The previous season keeps its
 * traces; older seasons keep scores, scoring plays, totals and player lines
 * and lose the trace. Nothing is invented to fill the gap — a game without a
 * trace says so (`describeTrace`).
 */
export const ARCHIVE_SEASONS_KEPT = 5;

/** Copy this season's human-team games into the archive. Call just before `games` is cleared. */
export function archiveSeasonGames(s: LeagueState): void {
  const humans = humanTeamsOf(s);
  const mine = s.games.filter(
    (g) => g.played && g.phase !== "PRE" && (humans.has(g.homeTeam) || humans.has(g.awayTeam)),
  );
  const archive = [...(s.gameArchive ?? [])];
  // the previous season's traces were the last ones worth their size
  for (let i = 0; i < archive.length; i++) {
    if (archive[i]!.broadcast) {
      const { broadcast: _dropped, ...rest } = archive[i]!;
      archive[i] = rest;
    }
  }
  for (const g of mine) {
    if (archive.some((a) => a.id === g.id)) continue;
    archive.push({ ...g, season: s.season });
  }
  const seasons = [...new Set(archive.map((g) => g.season))].sort((a, b) => a - b);
  const keep = new Set(seasons.slice(-ARCHIVE_SEASONS_KEPT));
  s.gameArchive = archive.filter((g) => keep.has(g.season));
}

/** A game by id: this season's first, then the archive. */
export function findGame(s: Pick<LeagueState, "games" | "gameArchive">, id: string | undefined): GameResult | undefined {
  if (!id) return undefined;
  return s.games.find((g) => g.id === id) ?? s.gameArchive?.find((g) => g.id === id);
}

export function archivedSeasonOf(s: Pick<LeagueState, "gameArchive">, id: string): number | null {
  return s.gameArchive?.find((g) => g.id === id)?.season ?? null;
}

export type TraceKind = "full" | "summary" | "none";

/** What can honestly be shown for a game: its recorded plays, its scoring summary, or only the score. */
export function describeTrace(g: GameResult | undefined): TraceKind {
  if (!g || !g.played) return "none";
  if (g.broadcast && g.broadcast.drives.length > 0) return "full";
  if (g.scoringPlays && g.scoringPlays.length > 0) return "summary";
  return "none";
}

export type { ArchivedGame };
