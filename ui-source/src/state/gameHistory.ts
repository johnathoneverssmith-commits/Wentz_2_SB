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
  // two windows, each counted over its own games: archiving a new preseason must not push a completed
  // season out of the regular-season window
  const lastN = (games: ArchivedGame[], n: number): Set<number> =>
    new Set([...new Set(games.map((g) => g.season))].sort((a, b) => a - b).slice(-n));
  const keep = lastN(archive.filter((g) => g.phase !== "PRE"), ARCHIVE_SEASONS_KEPT);
  const keepPre = lastN(archive.filter((g) => g.phase === "PRE"), ARCHIVE_PRESEASONS_KEPT);
  s.gameArchive = archive.filter((g) => (g.phase === "PRE" ? keepPre : keep).has(g.season));
}

/**
 * The archive as one GM may see it. Online, an entry is only for the GMs who
 * had revealed it; everyone else gets no trace of it (not a redacted stub: a
 * stub would still say the game exists, who played, and that it is archived).
 */
export function visibleArchive(archive: readonly ArchivedGame[] | undefined, gmId: string): ArchivedGame[] {
  // `seenBy` is who watched what: metadata about the other GMs, and not the viewer's to read
  return (archive ?? [])
    .filter((g) => g.seenBy === undefined || g.seenBy.includes(gmId))
    .map(({ seenBy: _who, ...rest }) => rest);
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

/**
 * A whole league handed to `useStore.setState` (an online fetch, joining, restoring a backup) merges over the
 * one in the store, so a league without an archive must say so or it inherits the previous league's.
 */
export function withLeagueArchive<T>(partial: T): T {
  if (typeof partial !== "object" || partial === null) return partial;
  const p = partial as Record<string, unknown>;
  if (!("teams" in p) || !("players" in p)) return partial;
  return ("gameArchive" in p ? p : { ...p, gameArchive: undefined }) as T;
}
