/**
 * How a CPU general manager reads a rookie draft board, from what a scout can
 * see: the public college grade, the projected round and range, the position.
 * Never `trueOverall`, which is revealed only at rookie signings.
 *
 * Why this exists. The college grade is a college-production number on a
 * different scale from the league's ratings: a first-round pick's grade
 * averages about 91, and he arrives near 74. The CPU used to compare that grade
 * straight to veterans' ratings, so every first-rounder looked like an instant
 * upgrade (99% did, where about 35% actually beat the weakest starter), a
 * drafted rookie "filled" his position's need at his inflated grade, and the
 * surplus check that is meant to stop a fourth quarterback almost never fired.
 * The projected range, which the board already prints, is the better signal
 * (the draft room's own "projects 70-81" comes from it).
 *
 * So a prospect is valued as the rookie rating his projected slot is worth on
 * average (`expectedRookieOverall`, the measured curve), and a team's incumbents
 * are valued as what they will be this coming season: age and contract
 * length count. Both sit on the league's rating scale, so a rookie is compared
 * with a veteran like with like.
 *
 * Plain data in, numbers out: `bestAvailable` (the human's suggestion and
 * the single-pick path) and `planAutopicks` (the CPU and "Autopick remaining")
 * call the same functions, so they cannot disagree.
 */
import type { DraftProspect, Position } from "@/domain";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";
import { SPECIALIST_ROOKIE_OFFSET, expectedRookieOverall, projectedSlot } from "@/sim/draft-outcomes";

/**
 * How strongly a GM's season strategy leans on positions in the rookie draft (it was 0.75, against a
 * score whose need term sat at a floor). Need is a real term now: left at 0.75, an offense-heavy GM's
 * fantasy-draft roster was so stacked on offense that its rookie picks went to defense (22% offense in
 * rounds 1-3 against a defense-heavy GM's 64%). Swept over 2, 3 and 4 on fresh and three-season leagues:
 * 2 is too weak on fresh leagues (offense-heavy 50% against defense-heavy 42%), 4 is too strong on mature
 * ones (a defense-heavy GM took 4% offense) and lowers the lineup gain; at 3 the strategies keep their
 * character (fresh 54% against 32%, mature 76% against 12%) at the best draft quality of the three.
 */
export const ROOKIE_STRATEGY_SCALE = 3;

/**
 * The strategy's lean on a position for the next pick there: full for the first, half for the second,
 * a quarter for the third. A GM keeps its character and still spreads its picks.
 */
export function strategyScaleFor(draftedHere: number): number {
  return ROOKIE_STRATEGY_SCALE * 0.5 ** draftedHere;
}

/** The stand-in "best at the position" when nobody is there; matches `positionalNeed`'s. */
const EMPTY_POSITION_BASE = 42;
/** How much of a gap to the weakest starter counts as need, in rating points. */
const NEED_GAIN = 1.0;
/** A pick who would not make the roster is a wasted pick (same size as the fantasy draft's). */
const SURPLUS_PENALTY = 25;
/** A prospect who would sit behind every starter loses this much of each point he trails by, up to the cap. */
const SHORTFALL_WEIGHT = 0.2;
const SHORTFALL_CAP = 20;
/** Beating the player he would displace at the bottom of the position counts this much, against a starting slot's 1. */
const DEPTH_WEIGHT = 0.3;
/** Rating points each earlier pick at a position costs the next one, at a position with three roster spots. */
const REPEAT_STEP = 1;

/** Seasons ahead an incumbent's outlook looks, and how much of the change counts. */
const HORIZON = 2;
const FUTURE_SHARE = 0.5;
/** Rating points a contract that ends inside the horizon is worth less, per year short (re-signing is a cost and a risk). */
const EXPIRY_DISCOUNT = 6;

/**
 * Where decline begins, by position: a public rule of thumb (running backs fade
 * early, quarterbacks and specialists late), not any one player's hidden
 * threshold.
 */
const DECLINE_START: Partial<Record<Position, number>> = {
  QB: 34, K: 36, P: 36, RB: 28, CB: 29, OT: 31, OG: 31, C: 31,
};
const DEFAULT_DECLINE_START = 30;

/** Position weight on need: the existing `POSITION_NEED_BONUS` expressed as a multiplier. */
const NEED_WEIGHT_BY_POSITION: Partial<Record<Position, number>> = {
  QB: 1 + 13 / 40, RB: 1 + 6 / 40, WR: 1 + 7 / 40, TE: 1 + 1 / 40, OT: 1 + 2 / 40, OG: 1 + 1 / 40, C: 1 + 1 / 40,
  EDGE: 1 + 3 / 40, DT: 1 + 3 / 40, ILB: 1 + 3 / 40, OLB: 1 - 6 / 40, CB: 1 + 5 / 40, S: 1 + 4 / 40, K: 1 - 9 / 40, P: 1 - 18 / 40,
};

const TEMPLATE = new Map(ROSTER_TEMPLATE.map((r) => [r.pos, r]));
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/**
 * The rookie rating each prospect projects to, by the public board.
 *
 * `accuracy` (0..1, a difficulty setting) is how much of the board's detail the
 * GM reads. At full accuracy the projected range places him; lower, the GM
 * trusts only the round and leans on the headline college grade (via the
 * grade's rank in this class, so no grade-to-slot constant is assumed). Lower
 * accuracy is a blurrier read, never a different scale: the result is always a
 * rating on the league's scale.
 */
export function expectedRatings(prospects: readonly DraftProspect[], accuracy: number): Map<string, number> {
  const acc = clamp(accuracy, 0, 1);
  const byGrade = [...prospects].sort((a, b) => b.collegeOverall - a.collegeOverall || (a.id < b.id ? -1 : 1));
  const gradeRank = new Map(byGrade.map((p, i) => [p.id, i + 1]));
  const trust = 0.08 + 0.5 * (1 - acc);
  const out = new Map<string, number>();
  for (const p of prospects) {
    const roundMiddle = (p.projectedRound - 1) * 32 + 16;
    const fromBoard = roundMiddle + (projectedSlot(p) - roundMiddle) * acc;
    const slot = (1 - trust) * fromBoard + trust * gradeRank.get(p.id)!;
    const specialist = p.position === "K" || p.position === "P";
    out.set(p.id, clamp(expectedRookieOverall(slot) + (specialist ? SPECIALIST_ROOKIE_OFFSET : 0), 40, specialist ? 90 : 88));
  }
  return out;
}

/** What an incumbent is worth to next season's lineup: his rating now, moved by age and contract. */
export function effectiveRating(
  p: { position: Position; overall: number; age: number; yearsLeft: number },
  longTermWeight: number,
): number {
  // the draft is held before the year turns: he plays next season a year older
  const age = p.age + 1;
  const start = DECLINE_START[p.position] ?? DEFAULT_DECLINE_START;
  const perYear = age <= 24 ? 0.8 : age < start ? 0 : -(1 + 0.8 * (age - start));
  let future = p.overall + perYear * HORIZON;
  if (p.yearsLeft < HORIZON) future -= (EXPIRY_DISCOUNT * (HORIZON - Math.max(0, p.yearsLeft))) / HORIZON;
  return p.overall + longTermWeight * FUTURE_SHARE * (future - p.overall);
}

/** A team's incumbents by position, as effective ratings. */
export function effectiveByPosition(
  incumbents: Iterable<{ position: Position; overall: number; age: number; yearsLeft: number }>,
  longTermWeight: number,
): Map<Position, number[]> {
  const out = new Map<Position, number[]>();
  for (const p of incumbents) {
    const list = out.get(p.position);
    const v = effectiveRating(p, longTermWeight);
    if (list) list.push(v);
    else out.set(p.position, [v]);
  }
  return out;
}

/**
 * What a prospect adds to a team, on the rating scale: what he is expected to be,
 * plus how much he improves the weakest starter slot (position-weighted, scaled
 * by how well the GM reads need), minus a penalty when he would not make the
 * roster or would sit behind every starter.
 *
 * `carried` is every effective rating the team holds at the position, any order,
 * counting its own picks in this draft at their expected rating.
 */
export function rookieValue(args: {
  expected: number;
  position: Position;
  carried: readonly number[];
  needAwareness: number;
  /** How many players this team has already taken at the position in this draft. */
  draftedHere?: number;
}): number {
  const { expected, position, carried, needAwareness, draftedHere = 0 } = args;
  const row = TEMPLATE.get(position);
  const starters = row?.starters ?? 0;
  const count = row?.count ?? 0;
  const sorted = [...carried].sort((a, b) => b - a);
  // the rating of the starter he would replace: the weakest starting slot (empty = nobody there)
  const weakest = starters > 0 ? (sorted[starters - 1] ?? EMPTY_POSITION_BASE) : Infinity;
  const gain = starters > 0 ? Math.max(0, expected - weakest) : 0;
  // depth: beating the player he would displace at the bottom of the position's roster spots is worth a
  // little; it shrinks as the team adds players there, which is what spreads a team's picks across positions
  const depthCut = count > starters ? (sorted.length < count ? EMPTY_POSITION_BASE : sorted[count - 1]!) : Infinity;
  const depthGain = Number.isFinite(depthCut) ? Math.max(0, expected - depthCut) : 0;
  const need = NEED_GAIN * (NEED_WEIGHT_BY_POSITION[position] ?? 1) * needAwareness * (gain + DEPTH_WEIGHT * depthGain);
  const shortfall = starters > 0 ? Math.min(SHORTFALL_CAP, Math.max(0, weakest - expected)) * SHORTFALL_WEIGHT : 0;
  // roster-spot waste: once the position holds its template count, one who would be the first cut
  const cutLine = sorted.length < count ? -Infinity : count === 0 ? Infinity : sorted[count - 1]!;
  const waste = expected <= cutLine ? SURPLUS_PENALTY : 0;
  // A specialist's rating runs on its own, higher scale (`SPECIALIST_ROOKIE_OFFSET`): that is what lets
  // him be compared with the kicker he would replace, and it does not make the slot worth more than
  // the same slot at any other position.
  const talent = position === "K" || position === "P" ? expected - SPECIALIST_ROOKIE_OFFSET : expected;
  // Each earlier pick at the position makes another one less worth taking, and the fewer roster spots
  // the position has, the faster (a third running back, a second kicker).
  const repeat = REPEAT_STEP * draftedHere * (3 / Math.max(2, count));
  return talent + need - shortfall - waste - repeat;
}
