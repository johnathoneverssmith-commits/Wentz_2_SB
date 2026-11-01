import type { DraftPickResult, Player } from "@/domain";

/**
 * Presentation helpers for the draft summary. These read draft results and
 * players; they do NOT grade a draft (grading lives with the draft-evaluation
 * code, and the summary still takes its letter grade and ranks from there).
 */
export interface ValuePick {
  id: string;
  name: string;
  position: string;
  overall: number;
  age: number;
  pickNumber: number;
  round: number;
  /** pick number minus the player's OVR rank among everyone drafted: positive = taken later than his rating suggests */
  value: number;
  /** that OVR rank among all drafted players (1 = best) */
  ovrRank: number;
}

/** A team's picks that were taken later than their rating ranks among the whole draft. */
export function bestValuePicks(
  results: readonly Pick<DraftPickResult, "pickNumber" | "teamCode" | "selectedId" | "round">[],
  players: Record<string, Player>,
  team: string,
  limit = 3,
): ValuePick[] {
  const drafted = results
    .map((r) => ({ r, p: r.selectedId ? players[r.selectedId] : undefined }))
    .filter((x): x is { r: (typeof results)[number]; p: Player } => !!x.p);
  // ovr rank: ties share the better rank so equal players don't differ in value
  const ovrs = drafted.map((x) => x.p.overall).sort((a, b) => b - a);
  const rankOf = (o: number) => ovrs.indexOf(o) + 1;
  return drafted
    .filter((x) => x.r.teamCode === team)
    .map((x) => {
      const ovrRank = rankOf(x.p.overall);
      return {
        id: x.p.id, name: x.p.name, position: x.p.position, overall: x.p.overall, age: x.p.age,
        pickNumber: x.r.pickNumber, round: x.r.round, ovrRank, value: x.r.pickNumber - ovrRank,
      };
    })
    .filter((v) => v.value > 0)
    .sort((a, b) => b.value - a.value || a.pickNumber - b.pickNumber)
    .slice(0, limit);
}

export interface UnitLike { key: string; label: string; rank: number; teams: number; weight: number }

/** Best and worst units by league rank, ignoring units that barely move games. */
export function strengthsAndWeaknesses<T extends UnitLike>(units: readonly T[], each = 2): { strengths: T[]; weaknesses: T[] } {
  const live = units.filter((u) => u.weight >= 0.05);
  const byRank = [...live].sort((a, b) => a.rank - b.rank);
  const strengths = byRank.slice(0, each);
  const weaknesses = byRank.filter((u) => !strengths.includes(u)).slice(-each).reverse();
  return { strengths, weaknesses };
}
