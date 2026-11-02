import type { LeagueState } from "@/domain";

/**
 * Draft VALUE: did a team get good players for where it picked?
 *
 * This is deliberately NOT roster strength. Strength (`projectedStrengths`
 * in unitReport.ts) asks "how good is this lineup, as the engine plays it",
 * and a team can score high on it by drafting every position well or
 * low on it despite drafting the best players available at every slot (it
 * took a third quarterback). Value asks the other question: against what the
 * board offered at each pick number, was the pick a steal or a reach?
 *
 * Pick n is compared with the n-th best overall among all players taken in
 * the draft, so the measure needs no stored pre-draft board and is the same
 * on every client. Positions are not weighted: that is a strength question.
 */
export interface TeamDraftValue {
  team: string;
  picks: number;
  /** summed (player overall − overall expected at that pick number); > 0 is a steal */
  valueOverSlot: number;
  /** the same, per pick, so a team with extra picks is not credited for having them */
  perPick: number;
}

export function draftValueByTeam(s: Pick<LeagueState, "draft" | "players">): Record<string, TeamDraftValue> {
  const d = s.draft;
  const out: Record<string, TeamDraftValue> = {};
  if (!d) return out;
  const taken = d.results.map((r) => ({ team: r.teamCode, overall: (r.selectedId ? s.players[r.selectedId]?.overall : undefined) }));
  const known = taken.filter((t): t is { team: string; overall: number } => t.overall !== undefined);
  const expected = known.map((t) => t.overall).sort((a, b) => b - a);
  known.forEach((t, i) => {
    const row = (out[t.team] ??= { team: t.team, picks: 0, valueOverSlot: 0, perPick: 0 });
    row.picks += 1;
    row.valueOverSlot += t.overall - expected[i]!;
  });
  for (const row of Object.values(out)) {
    row.valueOverSlot = Math.round(row.valueOverSlot * 10) / 10;
    row.perPick = Math.round((row.valueOverSlot / row.picks) * 100) / 100;
  }
  return out;
}
