import type { LeagueState } from "@/domain";
import { visibleGames } from "./reveal";

/**
 * Where each HUMAN-controlled franchise stands among the other human-controlled
 * franchises. CPU teams are never counted as competitors here: a GM who is
 * first among people is first, however the AI teams finished.
 *
 * Built from `visibleGames`, so a GM never sees a rank that depends on a game
 * they have not watched. Ranks are by winning percentage (a tie counts half a
 * win); equal percentages share a rank ("T-2") and the next rank skips, the
 * way a league table does. No tiebreaker is invented.
 */
export interface HumanRankRow {
  team: string;
  gmId: string;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  /** competition rank: 1, T-2, T-2, 4 ... */
  rank: number;
  tied: boolean;
  /** 1 = best, 0 = worst. Tied teams share the mean of the places they occupy. */
  standing: number;
}

export interface HumanRanking {
  rows: HumanRankRow[];
  /** at least two human franchises, each with a visible regular-season result */
  meaningful: boolean;
  byTeam: Record<string, HumanRankRow>;
}

const EMPTY: HumanRanking = { rows: [], meaningful: false, byTeam: {} };

export function humanRanking(s: LeagueState, viewerGmId: string): HumanRanking {
  const humans = s.gms.filter((g) => g.isHuman && g.teamCode && s.teams[g.teamCode]);
  if (humans.length === 0) return EMPTY;
  const rec = new Map<string, { w: number; l: number; t: number }>();
  for (const g of humans) rec.set(g.teamCode, { w: 0, l: 0, t: 0 });
  for (const game of visibleGames(s, viewerGmId)) {
    if (game.phase !== "REG") continue;
    const home = rec.get(game.homeTeam);
    const away = rec.get(game.awayTeam);
    const bump = (r: typeof home, mine: number, theirs: number) => {
      if (!r) return;
      if (mine > theirs) r.w += 1;
      else if (mine < theirs) r.l += 1;
      else r.t += 1;
    };
    bump(home, game.homeScore, game.awayScore);
    bump(away, game.awayScore, game.homeScore);
  }
  const base = humans.map((g) => {
    const r = rec.get(g.teamCode)!;
    const played = r.w + r.l + r.t;
    return { team: g.teamCode, gmId: g.id, wins: r.w, losses: r.l, ties: r.t, played, pct: played ? (r.w + r.t / 2) / played : 0 };
  });
  const sorted = [...base].sort((a, b) => b.pct - a.pct || a.team.localeCompare(b.team));
  const n = sorted.length;
  const rows: HumanRankRow[] = [];
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && Math.abs(sorted[j + 1]!.pct - sorted[i]!.pct) < 1e-9) j += 1;
    const tied = j > i;
    const meanPlace = (i + j) / 2; // zero-based
    for (let k = i; k <= j; k++) {
      const b = sorted[k]!;
      rows.push({
        team: b.team, gmId: b.gmId, wins: b.wins, losses: b.losses, ties: b.ties, pct: b.pct,
        rank: i + 1, tied, standing: n > 1 ? 1 - meanPlace / (n - 1) : 0.5,
      });
    }
    i = j + 1;
  }
  const meaningful = n >= 2 && base.every((b) => b.played > 0);
  return { rows, meaningful, byTeam: Object.fromEntries(rows.map((r) => [r.team, r])) };
}

/** "1", "T-2" */
export const rankLabel = (r: Pick<HumanRankRow, "rank" | "tied">): string => (r.tied ? `T-${r.rank}` : String(r.rank));

/**
 * 0 (infernal) .. 1 (heavenly), or 0.5 (neutral) when there is no meaningful
 * human ranking or the team is not a ranked human franchise.
 */
export function atmosphereLevel(ranking: HumanRanking, team: string | undefined): number {
  if (!team || !ranking.meaningful) return 0.5;
  return ranking.byTeam[team]?.standing ?? 0.5;
}
