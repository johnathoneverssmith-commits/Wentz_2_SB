/**
 * Cross-season scoring system — spec §5. Pure functions, unit-tested.
 *
 * Per-season point range: −1 (losing season, missed playoffs) up to 9
 * (#1-seed Super Bowl champion who also eliminated a rival human GM's team).
 */
import { ROUND_ORDER, type PlayoffRound, type SeasonOutcome } from "@/domain";
import type { SeasonScoreBreakdown } from "@/domain";

/** Rank of how far a team went; higher = farther. */
function progressRank(o: SeasonOutcome): number {
  if (o.wonSuperBowl) return 5;
  switch (o.furthestRound) {
    case "SB":
      return 4;
    case "CONF":
      return 3;
    case "DIV":
      return 2;
    case "WC":
      return 1;
    default:
      return 0;
  }
}

function roundsSurvived(o: SeasonOutcome): number {
  if (o.wonSuperBowl) return 4; // WC, DIV, CONF, SB all survived
  if (!o.madePlayoffs) return 0;
  // furthestRound is the round they were eliminated in; a #1-seed bye already
  // makes that round DIV or later, so indexOf naturally credits the WC bye.
  const idx = ROUND_ORDER.indexOf(o.furthestRound as PlayoffRound);
  return idx < 0 ? 0 : idx;
}

/** Bucket B — playoff progression (cumulative, independent per GM). */
export function bucketB(o: SeasonOutcome): number {
  return (o.madePlayoffs ? 1 : 0) + roundsSurvived(o) + (o.wonSuperBowl ? 2 : 0);
}

/** Bucket C — rival elimination bonus. */
export function bucketC(o: SeasonOutcome): number {
  return o.rivalsEliminated.length;
}

/** Bucket D — season quality. */
export function bucketD(o: SeasonOutcome): number {
  const g = o.regularSeasonRecord.wins + o.regularSeasonRecord.losses + o.regularSeasonRecord.ties;
  if (g === 0) return 0;
  const pct = (o.regularSeasonRecord.wins + 0.5 * o.regularSeasonRecord.ties) / g;
  return pct < 0.5 ? -1 : 0;
}

export interface ScoreSeasonInput {
  season: number;
  /** exactly one row per human GM. */
  outcomes: SeasonOutcome[];
  /** net head-to-head result between two GMs' teams this season; >0 favours a. */
  headToHead: (gmA: string, gmB: string) => number;
}

/**
 * Bucket A — regular-season placement. Awarded once per season to exactly one
 * GM, unless the final tiebreaker splits it.
 */
export function bucketA(input: ScoreSeasonInput): Record<string, number> {
  const { outcomes, headToHead } = input;
  const result: Record<string, number> = {};
  for (const o of outcomes) result[o.gmId] = 0;
  if (outcomes.length === 0) return result;

  const anyPlayoffs = outcomes.some((o) => o.madePlayoffs);

  let candidates: SeasonOutcome[];
  if (anyPlayoffs) {
    const best = Math.max(...outcomes.map(progressRank));
    candidates = outcomes.filter((o) => progressRank(o) === best);
  } else {
    // no human GM made the playoffs → best regular-season record
    const pct = (o: SeasonOutcome) => {
      const g = o.regularSeasonRecord.wins + o.regularSeasonRecord.losses + o.regularSeasonRecord.ties;
      return g === 0 ? 0 : (o.regularSeasonRecord.wins + 0.5 * o.regularSeasonRecord.ties) / g;
    };
    const best = Math.max(...outcomes.map(pct));
    candidates = outcomes.filter((o) => pct(o) === best);
  }

  if (candidates.length === 1) {
    result[candidates[0]!.gmId] = 1;
    return result;
  }

  // (1) same playoff round → smallest margin of defeat in the elimination game
  if (anyPlayoffs) {
    const withMargin = candidates.filter((o) => o.eliminationMargin != null);
    if (withMargin.length > 0) {
      const minMargin = Math.min(...withMargin.map((o) => o.eliminationMargin!));
      const m = withMargin.filter((o) => o.eliminationMargin === minMargin);
      if (m.length === 1) {
        result[m[0]!.gmId] = 1;
        return result;
      }
      candidates = m;
    }
  }

  // (2) head-to-head, only when exactly two GMs are tied
  if (candidates.length === 2) {
    const [a, b] = candidates as [SeasonOutcome, SeasonOutcome];
    const h2h = headToHead(a.gmId, b.gmId);
    if (h2h !== 0) {
      result[(h2h > 0 ? a : b).gmId] = 1;
      return result;
    }
  }

  // (3) season-long point differential
  const maxDiff = Math.max(...candidates.map((o) => o.pointDifferential));
  const byDiff = candidates.filter((o) => o.pointDifferential === maxDiff);
  if (byDiff.length === 1) {
    result[byDiff[0]!.gmId] = 1;
    return result;
  }

  // (4) split the point between the still-tied GMs
  const share = 1 / byDiff.length;
  for (const o of byDiff) result[o.gmId] = share;
  return result;
}

export function scoreSeason(input: ScoreSeasonInput): SeasonScoreBreakdown[] {
  const aByGm = bucketA(input);
  return input.outcomes.map((o) => {
    const a = aByGm[o.gmId] ?? 0;
    const b = bucketB(o);
    const c = bucketC(o);
    const d = bucketD(o);
    return {
      season: input.season,
      gmId: o.gmId,
      bucketA: a,
      bucketB: b,
      bucketC: c,
      bucketD: d,
      seasonTotal: a + b + c + d,
    };
  });
}
