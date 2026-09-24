/**
 * What a player adds to his team's *units* — the evaluator behind the
 * Master AI.
 *
 * Every other CPU level values a candidate by his own rating, his position
 * and how thin the team is there. That was a fair model of how a team wins
 * while the engine was additive. It is not any more: the engine's synergy
 * layer (`src/engine/synergy.ts`) makes a complete offensive line, a pair of
 * edge rushers, or a quarterback with a receiver worth far more than the
 * same ratings spread around, and makes a weak link cost far more than his
 * share. A GM that knows that — and builds units rather than collecting
 * ratings — beats one that doesn't, legally, with the same information.
 *
 * The model mirrors how the engine reads a unit: the starters' average,
 * pulled toward the weakest of them, because the rush goes where the weak
 * man is and a secondary is only as good as the corner the quarterback
 * picks on. It reads public ratings only — a rookie's `collegeOverall`,
 * never his hidden true rating.
 */

export interface Unit {
  /** position -> starters counted at that position */
  slots: Readonly<Record<string, number>>;
  /** 0 = plain average, 1 = only the weakest starter matters */
  weakLink: number;
  /** how much a point of unit strength is worth, relative to the others */
  weight: number;
}

/**
 * The units the engine reads, each weighted by what it is *measured* to be
 * worth: points of scoring margin per game for one rating point across the
 * whole unit (`analysis/35_position_value.ts` — per-starter values summed
 * over the unit's starters). Measured, not assumed, and some of it is not
 * what NFL convention says: a running back's point is worth nearly a
 * quarterback's here, a safety's more than an edge rusher's, and a kicker's
 * or punter's is worth nothing. OLB is not a lineup slot in the engine at all
 * — it only reaches the game through the team-strength index's depth — so it
 * carries almost no weight.
 */
export const UNITS: Readonly<Record<string, Unit>> = {
  offensiveLine: { slots: { OT: 2, OG: 2, C: 1 }, weakLink: 0.45, weight: 0.522 },
  passRush: { slots: { EDGE: 2 }, weakLink: 0.5, weight: 0.322 },
  interior: { slots: { DT: 2 }, weakLink: 0.35, weight: 0.166 },
  quarterback: { slots: { QB: 1 }, weakLink: 0, weight: 0.305 },
  receivers: { slots: { WR: 3 }, weakLink: 0.25, weight: 0.333 },
  tightEnd: { slots: { TE: 1 }, weakLink: 0, weight: 0.056 },
  runningBack: { slots: { RB: 1 }, weakLink: 0, weight: 0.282 },
  corners: { slots: { CB: 2 }, weakLink: 0.5, weight: 0.29 },
  safeties: { slots: { S: 2 }, weakLink: 0.35, weight: 0.364 },
  linebackers: { slots: { ILB: 2 }, weakLink: 0.3, weight: 0.23 },
  outsideLinebackers: { slots: { OLB: 2 }, weakLink: 0, weight: 0.02 },
};

/** Which unit a position belongs to. */
const UNIT_OF: Record<string, string> = {};
for (const [name, u] of Object.entries(UNITS)) for (const pos of Object.keys(u.slots)) UNIT_OF[pos] = name;

/**
 * A starting spot nobody has filled plays at replacement level — about what
 * the post-draft roster fill hands a team at that point (`fillRosterGaps`
 * signs the best affordable free agent), not an empty chair. Measuring a
 * first pick against 50 made every position look like a hole worth filling.
 */
const REPLACEMENT = 68;

/** Ratings at a position, any order. */
export type RatingsAt = (position: string) => readonly number[];

/** What an unfilled starting spot plays at, by position. */
export type Replacement = (position: string) => number;
const flatReplacement: Replacement = () => REPLACEMENT;

function unitStrength(
  unit: Unit,
  ratingsAt: RatingsAt,
  extra?: { position: string; value: number },
  replacement: Replacement = flatReplacement,
): number {
  const starters: number[] = [];
  for (const [pos, n] of Object.entries(unit.slots)) {
    const pool = [...ratingsAt(pos)];
    if (extra && extra.position === pos) pool.push(extra.value);
    pool.sort((a, b) => b - a);
    for (let i = 0; i < n; i++) starters.push(pool[i] ?? replacement(pos));
  }
  const mean = starters.reduce((a, b) => a + b, 0) / starters.length;
  const min = Math.min(...starters);
  return (1 - unit.weakLink) * mean + unit.weakLink * min;
}

/** The quarterback's pairing with his best receiver: each is capped by the other. */
function pairing(ratingsAt: RatingsAt, extra?: { position: string; value: number }): number {
  const best = (pos: string): number => {
    const v = [...ratingsAt(pos), ...(extra && extra.position === pos ? [extra.value] : [])];
    return v.length ? Math.max(...v) : REPLACEMENT;
  };
  return Math.min(best("QB"), best("WR"));
}
/** QB × WR1, in the same points-of-margin units as the unit weights. */
const PAIRING_WEIGHT = 0.08;

/**
 * How much adding a player of `value` at `position` strengthens the team's
 * units, in weighted rating points. Zero for a player who wouldn't start;
 * largest for one who fills a hole in a unit that is otherwise good — which
 * is exactly where the engine pays out.
 */
export function unitGain(ratingsAt: RatingsAt, position: string, value: number): number {
  const name = UNIT_OF[position];
  if (!name) return 0;
  const unit = UNITS[name]!;
  const extra = { position, value };
  let gain = (unitStrength(unit, ratingsAt, extra) - unitStrength(unit, ratingsAt)) * unit.weight;
  if (position === "QB" || position === "WR") {
    gain += (pairing(ratingsAt, extra) - pairing(ratingsAt)) * PAIRING_WEIGHT;
  }
  return gain;
}

/** Every unit's strength, weighted — the whole roster as the engine will read it. */
export function rosterUnitScore(ratingsAt: RatingsAt): number {
  let total = 0;
  for (const unit of Object.values(UNITS)) total += unitStrength(unit, ratingsAt) * unit.weight;
  return total + pairing(ratingsAt) * PAIRING_WEIGHT;
}

/**
 * `unitGain` for one team at one moment, with each unit's current strength
 * computed once. A draft asks this for every candidate at every pick — a
 * fantasy draft is 640 picks over ~1,900 players — and the "before" side is
 * the same for all of them.
 */
export function unitGainer(
  ratingsAt: RatingsAt,
  replacement: Replacement = flatReplacement,
): (position: string, value: number) => number {
  const before = new Map<string, number>();
  const pairBefore = pairing(ratingsAt);
  return (position, value) => {
    const name = UNIT_OF[position];
    if (!name) return 0;
    const unit = UNITS[name]!;
    let b = before.get(name);
    if (b === undefined) before.set(name, (b = unitStrength(unit, ratingsAt, undefined, replacement)));
    const extra = { position, value };
    let gain = (unitStrength(unit, ratingsAt, extra, replacement) - b) * unit.weight;
    if (position === "QB" || position === "WR") gain += (pairing(ratingsAt, extra) - pairBefore) * PAIRING_WEIGHT;
    return gain;
  };
}

/** Starting spots per team, by position — the unit slots, flattened. */
export const STARTERS_AT: Readonly<Record<string, number>> = Object.fromEntries(
  Object.values(UNITS).flatMap((u) => Object.entries(u.slots)),
);

/**
 * Replacement level by position, from what is left on the board.
 *
 * Value over replacement is how a draft is won: a player is worth what he
 * adds over the man you would get at that position by waiting, and that
 * depends on supply. Here it is the rating of the last player who would
 * still start somewhere — the league's remaining open starting spots at
 * the position, counted into the available players best-first. A position
 * with sixty-four starting spots (safety) runs out long before one with
 * thirty-two (quarterback), and a flat baseline never sees that.
 *
 * `available(pos)` is the undrafted ratings best-first; `filled(team, pos)`
 * how many a team already has there.
 */
export function replacementLevels(
  teams: readonly string[],
  available: (pos: string) => readonly number[],
  filled: (team: string, pos: string) => number,
): Replacement {
  const cache = new Map<string, number>();
  return (pos) => {
    let v = cache.get(pos);
    if (v !== undefined) return v;
    const per = STARTERS_AT[pos] ?? 0;
    let open = 0;
    for (const t of teams) open += Math.max(0, per - filled(t, pos));
    const pool = available(pos);
    v = open === 0 ? REPLACEMENT : (pool[Math.min(open, pool.length) - 1] ?? REPLACEMENT);
    cache.set(pos, v);
    return v;
  };
}
