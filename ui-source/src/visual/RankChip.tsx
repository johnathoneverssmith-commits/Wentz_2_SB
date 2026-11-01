import { useMemo } from "react";
import type { LeagueState } from "@/domain";
import { useStore } from "@/state/store";
import { atmosphereLevel, humanRanking, rankLabel } from "@/state/humanRank";
import { atmosphereName } from "./atmosphere";

/** Selects the human ranking for the viewing GM (recomputed only when games/gms change). */
export function useHumanRanking() {
  const teams = useStore((st) => st.teams);
  const gms = useStore((st) => st.gms);
  const games = useStore((st) => st.games);
  const reveal = useStore((st) => st.reveal);
  const viewer = useStore((st) => st.viewerGmId);
  return useMemo(() => humanRanking({ teams, gms, games, reveal } as unknown as LeagueState, viewer), [teams, gms, games, reveal, viewer]);
}

/**
 * "Human GM rank 2 of 4": shown beside a team name, only when a ranking among
 * human-controlled franchises is meaningful. Renders nothing otherwise, so no
 * rank is ever invented.
 */
export function RankChip({ team, className = "" }: { team: string | undefined; className?: string }) {
  const ranking = useHumanRanking();
  const row = team ? ranking.byTeam[team] : undefined;
  if (!ranking.meaningful || !row) return null;
  const level = atmosphereLevel(ranking, team);
  const mood = level >= 0.9 ? "heaven" : level <= 0.1 ? "hell" : "";
  const n = ranking.rows.length;
  return (
    <span className={`rank-chip ${mood} ${className}`} role="status" aria-label={`Rank among human GMs: ${rankLabel(row)} of ${n}. ${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}. Atmosphere ${atmosphereName(level, true)}.`}>
      <span className="rk" aria-hidden="true">{rankLabel(row)}</span>
      <span aria-hidden="true">
        Human-GM rank <small>of {n}</small>
        <span className="mood"> · {atmosphereName(level, true)}</span>
      </span>
    </span>
  );
}
