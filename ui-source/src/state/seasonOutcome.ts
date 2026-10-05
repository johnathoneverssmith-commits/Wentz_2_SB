import { type LeagueState, ROUND_ORDER, type SeasonOutcome } from "@/domain";

/**
 * How one GM's season went with one team: record, whether they made the
 * playoffs and how far, and whom they knocked out. For a person (the history
 * the hot seat reads) and for a CPU GM (`aiGms.ts`), by the same rule.
 */
export function seasonOutcomeFor(state: LeagueState, gmId: string, teamCode: string): SeasonOutcome {
  const bracket = state.bracket;
  const t = state.teams[teamCode]!;
  const madePlayoffs = !!bracket && (bracket.seeds.AFC.includes(teamCode) || bracket.seeds.NFC.includes(teamCode));
  const seed = madePlayoffs ? [...bracket!.seeds.AFC, ...bracket!.seeds.NFC].indexOf(teamCode) % 7 + 1 : 0;
  let furthest: SeasonOutcome["furthestRound"] = "none";
  let elimMargin: number | null = null;
  const rivalsEliminated: string[] = [];
  if (madePlayoffs && bracket) {
    for (const r of ROUND_ORDER) {
      const m = bracket.matchups.find((x) => x.round === r && (x.highSeed?.code === teamCode || x.lowSeed?.code === teamCode));
      if (!m || m.winner == null) break;
      if (m.winner === teamCode) {
        furthest = r;
        const opp = m.highSeed?.code === teamCode ? m.lowSeed?.code : m.highSeed?.code;
        if (opp && state.gms.some((x) => x.isHuman && x.teamCode === opp)) rivalsEliminated.push(opp);
      } else {
        furthest = r;
        elimMargin = Math.abs((m.homeScore ?? 0) - (m.awayScore ?? 0));
        break;
      }
    }
  }
  return {
    season: state.season,
    gmId,
    teamCode,
    madePlayoffs,
    seed,
    furthestRound: furthest,
    wonSuperBowl: bracket?.champion === teamCode,
    regularSeasonRecord: { wins: t.wins, losses: t.losses, ties: t.ties },
    eliminationMargin: bracket?.champion === teamCode ? null : elimMargin,
    pointDifferential: t.pointsFor - t.pointsAgainst,
    rivalsEliminated,
  };
}
