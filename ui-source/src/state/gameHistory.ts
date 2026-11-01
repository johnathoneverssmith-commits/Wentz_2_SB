import type { ArchivedGame, GameResult, LeagueState } from "@/domain";
import { visibleGames } from "./reveal";
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

/** Preseason games are kept for this many seasons, without traces: they matter far less than real ones. */
export const ARCHIVE_PRESEASONS_KEPT = 2;

export interface ArchiveOptions {
  /**
   * Online: record which GMs had revealed each game, so `visibleArchive` can
   * keep it from anyone who had not. Solo leagues leave this off.
   */
  gated?: boolean;
  /** Archive only this phase group (the preseason wipe runs mid-season; the rollover runs the rest). */
  only?: "PRE";
}

/**
 * Copy this season's human-team games into the archive. Call it *before*
 * `games` is cleared and before the season number moves (the games are tagged
 * with `s.season`). Idempotent by game id.
 */
export function archiveSeasonGames(s: LeagueState, opts: ArchiveOptions = {}): void {
  const humans = humanTeamsOf(s);
  const mine = s.games.filter(
    (g) =>
      g.played &&
      (opts.only ? g.phase === opts.only : true) &&
      (humans.has(g.homeTeam) || humans.has(g.awayTeam)),
  );
  const gmIds = s.gms.filter((g) => g.isHuman).map((g) => g.id);
  const archive = [...(s.gameArchive ?? [])];
  // the previous season's traces were the last ones worth their size
  if (!opts.only) {
    for (let i = 0; i < archive.length; i++) {
      if (archive[i]!.broadcast) {
        const { broadcast: _dropped, ...rest } = archive[i]!;
        archive[i] = rest;
      }
    }
  }
  for (const g of mine) {
    if (archive.some((a) => a.id === g.id)) continue;
    const { broadcast: trace, ...rest } = g;
    // a preseason trace is never worth keeping; the others keep theirs until the next rollover
    const entry: ArchivedGame = { ...(g.phase === "PRE" ? rest : { ...rest, ...(trace ? { broadcast: trace } : {}) }), season: s.season };
    if (opts.gated) {
      entry.seenBy = gmIds.filter((id) => visibleGames(s, id).some((x) => x.id === g.id));
    }
    archive.push(entry);
  }
  const seasons = [...new Set(archive.map((g) => g.season))].sort((a, b) => a - b);
  const keep = new Set(seasons.slice(-ARCHIVE_SEASONS_KEPT));
  const preSeasons = [...new Set(archive.filter((g) => g.phase === "PRE").map((g) => g.season))].sort((a, b) => a - b);
  const keepPre = new Set(preSeasons.slice(-ARCHIVE_PRESEASONS_KEPT));
  s.gameArchive = archive.filter((g) => keep.has(g.season) && (g.phase !== "PRE" || keepPre.has(g.season)));
}

/**
 * The archive as one GM may see it. Online, an entry is only for the GMs who
 * had revealed it; everyone else gets no trace of it (not a redacted stub: a
 * stub would still say the game exists, who played, and that it is archived).
 */
export function visibleArchive(archive: readonly ArchivedGame[] | undefined, gmId: string): ArchivedGame[] {
  return (archive ?? []).filter((g) => g.seenBy === undefined || g.seenBy.includes(gmId));
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
