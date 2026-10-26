/**
 * What a free agent is worth to a team's lineup, as a CPU front office prices it.
 *
 * It used to be `overall - the team's best at the position`: one number per position, the same for a
 * quarterback as for a kicker, blind to the second and third starting slots (a receiver's, a tackle's,
 * an edge rusher's) and to a player the team has already made an offer to. A kicker rated 86 against
 * the team's 70 looked like a sixteen-point upgrade at the position that wins games, and 28% of the
 * market's signings were kickers and punters.
 *
 * So a signing is the rating gain over the weakest starter he would join (the slot he actually
 * fills), plus a little for depth where the position carries reserves, times what a rating point at
 * that position is worth (`positionValueWeight`, the engine's measure blended with the market's, the
 * same hierarchy the rookie draft uses). A player the team has already bid on counts as on the roster.
 *
 * Plain numbers in, numbers out, so the CPU's turn and a person's staff share one evaluation.
 */
import type { Position } from "@/domain";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { positionValueWeight } from "./draftBoard.ts";

const TEMPLATE = new Map(ROSTER_TEMPLATE.map((r) => [r.pos, r]));

/** What a vacant starting slot is worth filling with, on the rating scale (an empty position, not a good player). */
export const EMPTY_SLOT_RATING = 42;
/** How much a better reserve is worth against a better starter, where the position carries reserves. */
export const DEPTH_WEIGHT = 0.1;
/** The least a signing must be worth, in weighted rating points, for a CPU team to bid at all. */
export const MIN_SIGNING_VALUE = 6;
/**
 * The same bar in the mid-season market. The pool there is what the offseason left (the best free agent in a
 * typical league is a 76, where the offseason's is in the 90s), so almost nothing clears 6 and the market went
 * dead: no team signed anyone in round 1. What a team does in season is cover depth and injuries, which are
 * smaller gains; the bar's job, stopping churn when the pool is rich, does not arise.
 */
export const MIN_SIGNING_VALUE_MIDSEASON = 3;

/** The bar for the market that is open. */
export function signingBar(stage: string): number {
  return stage === "midseasonFreeAgency" ? MIN_SIGNING_VALUE_MIDSEASON : MIN_SIGNING_VALUE;
}

/**
 * The rating points a player adds to a team: over its weakest starter at his position, plus a share of what
 * he adds over its weakest reserve. `carried` is every rating the team holds at the position, signed or
 * bid on, in any order.
 */
export function slotGain(rating: number, position: Position, carried: readonly number[]): number {
  const row = TEMPLATE.get(position);
  const starters = row?.starters ?? 0;
  const count = row?.count ?? 0;
  const sorted = [...carried].sort((a, b) => b - a);
  const weakest = starters > 0 ? (sorted[starters - 1] ?? EMPTY_SLOT_RATING) : Infinity;
  const gain = starters > 0 ? Math.max(0, rating - weakest) : 0;
  const depthCut = count > starters ? (sorted.length < count ? EMPTY_SLOT_RATING : sorted[count - 1]!) : Infinity;
  const depthGain = Number.isFinite(depthCut) ? Math.max(0, rating - depthCut) : 0;
  return gain + DEPTH_WEIGHT * depthGain;
}

/** What a signing is worth to the lineup: the slot gain priced by the position's weight. */
export function signingValue(rating: number, position: Position, carried: readonly number[]): number {
  return positionValueWeight(position) * slotGain(rating, position, carried);
}
