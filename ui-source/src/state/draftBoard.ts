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
import { TRADE_POSITION_VALUE } from "@/sim/MockSimulationService";

/**
 * What a point of rating is worth at each position, in rating points, as the engine measures it
 * (about 9·ln(value/0.8) of `POSITION_VALUE` in MockSimulationService): a running back or safety
 * carries a game here, a tight end or an outside linebacker barely touches one. The fantasy draft
 * ranks veterans with it directly.
 */
export const POSITION_VALUE: Record<Position, number> = {
  QB: 10,
  RB: 7,
  S: 4,
  EDGE: 4,
  WR: 4,
  CB: 3,
  ILB: 1,
  OT: 1,
  OG: 0,
  C: 0,
  DT: 0,
  TE: -3,
  OLB: -8,
  K: -14,
  P: -14,
};

/** The same scale from the market's hierarchy (`TRADE_POSITION_VALUE`: what teams actually pay for each position). */
function marketPremium(position: Position): number {
  return 9 * Math.log((TRADE_POSITION_VALUE[position] ?? 1) / 0.9);
}

/**
 * What a position is worth in a rookie pick, in rating points: the NFL market's hierarchy, tempered
 * by the engine's measure (a quarter of it). The engine alone would draft running backs and safeties
 * the way no front office does; the market alone ignores what wins games here. The sum is
 * compressed (PREMIUM_CAP) so that no one position, the quarterback above all, can outweigh the
 * whole of a rookie's projection.
 */
/** The engine's share of the blend (the rest is the market's), and the most a position's premium can reach. */
const ENGINE_SHARE = 0.25;
const PREMIUM_CAP = 5;

export function positionPremium(position: Position): number {
  const raw = ENGINE_SHARE * POSITION_VALUE[position] + (1 - ENGINE_SHARE) * marketPremium(position);
  return PREMIUM_CAP * Math.tanh(raw / PREMIUM_CAP);
}

/**
 * How much of that premium a rookie pick carries. Rookies sit on a narrow rating band (a top-10 pick
 * projects to 74 and a pick at 100 to 65), so the veteran-sized premium would put a fourth-round
 * quarterback above the best player in the class.
 */
export const ROOKIE_PREMIUM_SCALE = 0.6;

/**
 * How much a pick's need counts, by where it falls in the draft: little at the top, where teams take the
 * best player on the board, and more in the middle and late rounds, where holes are filled.
 */
export function slotNeedWeight(pickIndex: number): number {
  return 0.5 + 0.7 * (1 - Math.exp(-Math.max(0, pickIndex) / 60));
}

/**
 * How much of the market's fill a GM counts on, before its cap planning. Free agency is contested and
 * uncertain: a hole a free agent could fill is a smaller need, not no need. Swept at 0, 0.4, 0.7 and 1 on
 * identical leagues: 0.4 keeps most of the draft's own lineup gain and its starter rate and still stops early
 * kickers and punters (9 in rounds 1-3 over four mature leagues down to 1); at 1 the draft stopped filling holes
 * at all and gave back a quarter of that gain.
 */
const MARKET_RELIANCE = 0.4;

/** A free agent a team might sign instead of drafting for a hole. */
export interface MarketPlayer {
  position: Position;
  overall: number;
  age: number;
  /** what he asks, $M a year */
  asking: number;
}

/** A team at the market: its cap room and the weakest starting slot it has at each position (effective rating). */
export interface MarketTeam {
  code: string;
  capRoom: number;
  weakest: Partial<Record<Position, number>>;
}

/** No team spends more than this share of its cap room on one free agent. */
const AFFORD_SHARE = 0.5;
/** A free agent has to beat the weakest starter by this much to be worth signing. */
const SIGNING_MARGIN = 2;

/**
 * The free agent each team can realistically sign at each position, if any.
 *
 * Free agency follows the draft and its pool is public, so a hole is only a hole if the market
 * cannot fill it. But the market is not unlimited: thirty-one teams cannot all sign the best tackle.
 * Every starting slot in the league is served neediest first, each taking the best remaining free
 * agent its team can afford (no more than a share of the cap room it has left, which each signing
 * spends down) and who actually upgrades it. Served one position at a time, a team's cap room was
 * spent again at every position: on three-season leagues 27 of 32 teams were assumed to sign two or
 * more free agents (up to ten) and six to eleven of them to spend more than all the room they had.
 * Plain data in, a rating per team and position out; a team with nothing realistic gets no entry.
 */
export function freeAgentAlternatives(
  teams: readonly MarketTeam[],
  pool: readonly MarketPlayer[],
  longTermWeight = 1,
): Map<string, Map<Position, number>> {
  const out = new Map<string, Map<Position, number>>();
  const byPosition = new Map<Position, { rating: number; asking: number }[]>();
  for (const p of pool) {
    const rating = effectiveRating({ position: p.position, overall: p.overall, age: p.age, yearsLeft: 3 }, longTermWeight);
    const l = byPosition.get(p.position);
    if (l) l.push({ rating, asking: p.asking });
    else byPosition.set(p.position, [{ rating, asking: p.asking }]);
  }
  for (const list of byPosition.values()) list.sort((a, b) => b.rating - a.rating || a.asking - b.asking);
  // every team's starting slots at the positions the market has anyone at, neediest first across the league
  const slots: { code: string; position: Position; weakest: number }[] = [];
  for (const team of teams) {
    for (const position of byPosition.keys()) {
      if ((TEMPLATE.get(position)?.starters ?? 0) === 0) continue;
      slots.push({ code: team.code, position, weakest: team.weakest[position] ?? EMPTY_POSITION_BASE });
    }
  }
  slots.sort((a, b) => a.weakest - b.weakest || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.position < b.position ? -1 : 1));
  const room = new Map(teams.map((t) => [t.code, t.capRoom]));
  for (const slot of slots) {
    const list = byPosition.get(slot.position)!;
    const left = room.get(slot.code)!;
    const at = list.findIndex((f) => f.asking <= left * AFFORD_SHARE && f.rating >= slot.weakest + SIGNING_MARGIN);
    if (at < 0) continue;
    const signed = list.splice(at, 1)[0]!;
    room.set(slot.code, left - signed.asking);
    const m = out.get(slot.code) ?? new Map<Position, number>();
    m.set(slot.position, signed.rating);
    out.set(slot.code, m);
  }
  return out;
}

/**
 * How strongly a GM's season strategy leans on positions in the rookie draft (it was 0.75, against a
 * score whose need term sat at a floor). Need is a real term now: left at 0.75, an offense-heavy GM's
 * fantasy-draft roster was so stacked on offense that its rookie picks went to defense (22% offense in
 * rounds 1-3 against a defense-heavy GM's 64%). Swept over 2, 3 and 4 on fresh and three-season leagues:
 * 2 is too weak on fresh leagues (offense-heavy 50% against defense-heavy 42%), 4 is too strong on mature
 * ones (a defense-heavy GM took 4% offense) and lowers the lineup gain; at 3 the strategies keep their
 * character (fresh 54% against 32%, mature 76% against 12%) at the best draft quality of the three.
 * Lowered to 2.5 when need began to count for less at the top of the draft (slotNeedWeight), which had
 * been the counterweight to strategy there: it keeps the fresh-league gap (62%-31% at 3, 54%-31% at 2.5,
 * against 54%-32% before) and the draft quality, and 2 muted strategies on fresh leagues altogether (43%-40%).
 */
export const ROOKIE_STRATEGY_SCALE = 2.5;

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
 * How much a prospect improves the lineup, in rating points: the weakest starting slot he would take
 * (a slot the market can fill is a smaller hole: free agency follows the draft and its pool is public,
 * and how much of that a GM counts on is its cap planning), plus a little for beating the player he
 * would displace at the bottom of the position's roster spots, which shrinks as the team adds players
 * there and so spreads a team's picks across positions.
 */
function lineupGain(args: {
  expected: number;
  position: Position;
  carried: readonly number[];
  alternative?: number;
  capPlanningWeight?: number;
}): number {
  const { expected, position, carried, alternative = 0, capPlanningWeight = 1 } = args;
  const row = TEMPLATE.get(position);
  const starters = row?.starters ?? 0;
  const count = row?.count ?? 0;
  const sorted = [...carried].sort((a, b) => b - a);
  const weakest = starters > 0 ? (sorted[starters - 1] ?? EMPTY_POSITION_BASE) : Infinity;
  const marketFloor = alternative > 0 ? EMPTY_POSITION_BASE + MARKET_RELIANCE * capPlanningWeight * (alternative - EMPTY_POSITION_BASE) : -Infinity;
  const gain = starters > 0 ? Math.max(0, expected - Math.max(weakest, marketFloor)) : 0;
  const depthCut = count > starters ? (sorted.length < count ? EMPTY_POSITION_BASE : sorted[count - 1]!) : Infinity;
  const depthGain = Number.isFinite(depthCut) ? Math.max(0, expected - depthCut) : 0;
  return gain + DEPTH_WEIGHT * depthGain;
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
  /** Where this pick falls in the draft, from 0: need counts for less at the top (`slotNeedWeight`). */
  pickIndex?: number;
  /** The free agent this team could realistically sign at the position (a rating), 0 if none (`freeAgentAlternatives`). */
  alternative?: number;
  /** How well the GM plans around the market and its cap: scales how much of that alternative it counts on. */
  capPlanningWeight?: number;
}): number {
  const { expected, position, carried, needAwareness, draftedHere = 0, pickIndex = 0, alternative = 0, capPlanningWeight = 1 } = args;
  const row = TEMPLATE.get(position);
  const starters = row?.starters ?? 0;
  const count = row?.count ?? 0;
  const sorted = [...carried].sort((a, b) => b - a);
  // the rating of the starter he would replace: the weakest starting slot (empty = nobody there)
  const weakest = starters > 0 ? (sorted[starters - 1] ?? EMPTY_POSITION_BASE) : Infinity;
  const lineup = lineupGain({ expected, position, carried, alternative, capPlanningWeight });
  const need = NEED_GAIN * (NEED_WEIGHT_BY_POSITION[position] ?? 1) * needAwareness * slotNeedWeight(pickIndex) * lineup;
  const shortfall = starters > 0 ? Math.min(SHORTFALL_CAP, Math.max(0, weakest - expected)) * SHORTFALL_WEIGHT : 0;
  // roster-spot waste: once the position holds its template count, one who would be the first cut
  const cutLine = sorted.length < count ? -Infinity : count === 0 ? Infinity : sorted[count - 1]!;
  const waste = expected <= cutLine ? SURPLUS_PENALTY : 0;
  // A specialist's rating runs on its own, higher scale (`SPECIALIST_ROOKIE_OFFSET`): that is what lets
  // him be compared with the kicker he would replace, and it does not make the slot worth more than
  // the same slot at any other position.
  // What the position is worth then adds its premium (`positionPremium`).
  const talent =
    (position === "K" || position === "P" ? expected - SPECIALIST_ROOKIE_OFFSET : expected) + ROOKIE_PREMIUM_SCALE * positionPremium(position);
  // Each earlier pick at the position makes another one less worth taking, and the fewer roster spots
  // the position has, the faster (a third running back, a second kicker).
  const repeat = REPEAT_STEP * draftedHere * (3 / Math.max(2, count));
  return talent + need - shortfall - waste - repeat;
}
