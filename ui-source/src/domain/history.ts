/**
 * Cross-season scoring system (spec §5). Pure data shapes; the computation
 * lives in `sim/scoring.ts`.
 */

export interface SeasonScoreBreakdown {
  season: number;
  gmId: string;
  /** Bucket A — regular-season placement (0 or 1, or a fractional split). */
  bucketA: number;
  /** Bucket B — playoff progression (made playoffs, rounds survived, SB win). */
  bucketB: number;
  /** Bucket C — rival elimination bonus. */
  bucketC: number;
  /** Bucket D — season quality (−1 for a losing season). */
  bucketD: number;
  seasonTotal: number;
}

export interface GmLedger {
  gmId: string;
  perSeason: SeasonScoreBreakdown[];
  cumulative: number;
}
