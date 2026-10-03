import type { GameResult, LeagueState } from "@/domain";

/**
 * "80 OVR · 3-1" for a team as of a slate: its rating, and its record in that
 * phase's games through that week. Built only from the games it is given, so
 * a screen passes what the GM has revealed and never shows an unwatched
 * result. A playoff slate reads the regular-season record, since that is what
 * a team brought to January.
 */
export function teamInfoFor(
  s: LeagueState,
  games: readonly GameResult[],
  phase: string,
  throughWeek: number,
): (team: string) => string {
  const rec = new Map<string, { w: number; l: number; t: number }>();
  const recordPhase = phase === "PRE" ? "PRE" : "REG";
  const through = recordPhase === phase ? throughWeek : Infinity;
  for (const g of games) {
    if (g.phase !== recordPhase || !g.played || g.week > through) continue;
    for (const [team, us, them] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore],
    ] as const) {
      const r = rec.get(team) ?? { w: 0, l: 0, t: 0 };
      if (us > them) r.w++;
      else if (us < them) r.l++;
      else r.t++;
      rec.set(team, r);
    }
  }
  return (team: string): string => {
    const ovr = s.teams[team]?.ratings.overall;
    const r = rec.get(team) ?? { w: 0, l: 0, t: 0 };
    const record = `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
    return [ovr != null ? `${ovr} OVR` : "", record].filter(Boolean).join(" · ");
  };
}
