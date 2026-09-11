import type { LeagueState, SeasonScoreBreakdown } from "@/domain";
import { scoreSeason } from "@/sim/scoring";

export interface ScoreTracker {
  seasons: Array<{ season: number; breakdowns: SeasonScoreBreakdown[] }>;
  cumulative: Map<string, number>;
  leader: { gmId: string; total: number } | null;
}

/** Roll `state.history` through the §5 scoring into per-season + cumulative totals. */
export function buildScoreTracker(s: LeagueState): ScoreTracker {
  const seasonNums = [...new Set(s.history.map((h) => h.season))].sort((a, b) => a - b);
  const seasons = seasonNums.map((season) => {
    const outcomes = s.history.filter((h) => h.season === season);
    return {
      season,
      breakdowns: scoreSeason({ season, outcomes, headToHead: () => 0 }),
    };
  });

  const cumulative = new Map<string, number>(
    s.gms.filter((g) => g.isHuman).map((g) => [g.id, 0]),
  );
  for (const { breakdowns } of seasons) {
    for (const b of breakdowns) cumulative.set(b.gmId, (cumulative.get(b.gmId) ?? 0) + b.seasonTotal);
  }

  const sorted = [...cumulative.entries()].sort((a, b) => b[1] - a[1]);
  return {
    seasons,
    cumulative,
    leader: sorted[0] ? { gmId: sorted[0][0], total: sorted[0][1] } : null,
  };
}
