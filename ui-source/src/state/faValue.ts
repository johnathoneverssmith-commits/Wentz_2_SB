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
import { effectiveRating, positionValueWeight, teamHorizon, windowEffect } from "./draftBoard.ts";

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

/** Rating points a year of age under the reference is worth to a rebuilding team, at full rebuild and a position weighted 1. */
export const FA_YOUTH_POINTS = 1.2;
/** Years of age either side of the reference that count. */
export const FA_YOUTH_RANGE = 2;
/** The age at which a free agent is neither young nor old for a rebuild: about the age the market signs at. */
export const FA_REFERENCE_AGE = 28;

/**
 * Seasons off the draft's horizon in this market. The draft looks two years out for a team in between, one for a
 * contender and three for a rebuild; a free agent is bought for the season ahead (and signed to a contract of his own),
 * so a contender reads him as he is, a team in between one season on and a rebuild two. Measured on mature leagues, at
 * the draft's own horizon contenders came out as young as rebuilders (the age gap between them was +0.6 years, not +0.9).
 */
export const FA_HORIZON_SHIFT = 1;

/** Which of the year's two five-round markets is open. */
export type FaMarket = "offseason" | "midseason";

/** The market a stage belongs to: only `midseasonFreeAgency` is the mid-season one. */
export function marketOfStage(stage: string): FaMarket {
  return stage === "midseasonFreeAgency" ? "midseason" : "offseason";
}

/** The bar for the market that is open. */
export function signingBar(market: FaMarket): number {
  return market === "midseason" ? MIN_SIGNING_VALUE_MIDSEASON : MIN_SIGNING_VALUE;
}

/**
 * How a team reads the market, from the timeline it had when the market opened: how many seasons ahead its
 * outlook on a player reaches (the draft's `teamHorizon` less `FA_HORIZON_SHIFT`: none for a contender, two for a rebuild), the
 * weight it puts on the future (the GM's `longTermWeight`), and how far it is rebuilding (0 for a team that is
 * not). Without a recorded timeline (a save from before it was) there is no outlook: ratings are read as they are.
 */
export interface FaOutlook {
  horizon: number;
  longTermWeight: number;
  rebuild: number;
}

export function outlookFor(timeline: number | undefined, longTermWeight: number): FaOutlook | null {
  if (timeline === undefined) return null;
  const fx = windowEffect(timeline, longTermWeight);
  return { horizon: Math.max(0, teamHorizon(fx) - FA_HORIZON_SHIFT), longTermWeight, rebuild: Math.max(0, -fx) };
}

/**
 * A player's rating as the team reads it over its horizon: the draft's age curve (growth to 24, decline from
 * the position's start), halved, so a veteran a rebuild looks three seasons out on is worth less than the same
 * rating in a young player, and a contender looking one season out barely differs. The contract is left out:
 * a free agent signs for the years he is offered, and an incumbent's expiry is not what a market weighs.
 */
export function outlookRating(p: { position: Position; overall: number; age: number }, o: FaOutlook | null): number {
  if (!o) return p.overall;
  return effectiveRating({ position: p.position, overall: p.overall, age: p.age, yearsLeft: 99 }, o.longTermWeight, o.horizon);
}

/**
 * What a rebuilding team adds for a young player, or takes off for an old one, in the weighted points of
 * `signingValue`. Only a rebuild has it. A veteran on a one-year deal costs a rebuild nothing in the future, so
 * the penalty for age does not apply to him (his decline is still in `outlookRating`); a young player keeps the
 * preference whatever the length. Used to choose between signings that are worth making, never to make one.
 */
export function youthPreference(p: { position: Position; age: number }, o: FaOutlook | null, oneYear: boolean): number {
  if (!o || o.rebuild <= 0) return 0;
  const years = Math.max(-FA_YOUTH_RANGE, Math.min(FA_YOUTH_RANGE, FA_REFERENCE_AGE - p.age));
  if (years < 0 && oneYear) return 0;
  return positionValueWeight(p.position) * FA_YOUTH_POINTS * o.rebuild * years;
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
