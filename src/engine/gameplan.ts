/**
 * A team's game plan: the dials a coach sets for a stretch of games.
 *
 * Every dial is a *change from what the validated engine does*, so the default
 * plan (all zeros, the league's usual personnel mix) is exactly the engine as
 * it was: byte-identical, and every league average stays where it was fitted.
 * Dials move a team off the average and each has a price, so none is free:
 *
 *  - pass vs run: more throws means more sacks, interceptions and a clock that
 *    stops, fewer runs means a defence that stops respecting the back
 *  - fourth down, in three zones: going for it keeps drives alive and gives up
 *    field goals and punts' field position; the engine's own conversion odds
 *    decide whether it pays
 *  - blitz: pressure and sacks against completions and big plays when it's beaten
 *    (the same trade a coordinator's blitz bias makes, `staff-shift.ts`)
 *  - personnel: 11 (three receivers), 12 (two tight ends), 13 (three): more tight
 *    ends block better and run better, and throw worse
 *  - running backs: one workhorse, or a committee. A back who shares the work is
 *    fresher; the backup is worse
 *
 *  - quarterback runs: scrambles and designed keepers. They pay in proportion to
 *    how athletic the quarterback is and cost in proportion to how much he is not
 *  - two-point tries: the standard chart, leaned toward going for it or kicking
 *  - fourth and short, fourth and long: on top of where on the field the ball is
 *  - kickoffs and returns: deep for the touchback or pinned and covered; return
 *    everything or fair catch
 *  - rookies: play the kids ahead of near-equal veterans (they develop, you lose
 *    a little now) or keep them on the bench
 *
 * The three fourth-down dials, the short/long thresholds, the two-point chart
 * and the kick dials don't apply in the last two minutes of the game, where the
 * clock decides what a team does and not the plan. And no dial can talk a team
 * into a decision no coach would make (a fourth-and-17 from its own 20, a
 * 66-yard field goal, kicking the extra point down two with a minute left):
 * `fourthSane`, `FIELD_GOAL_LIMIT` and `twoPointProb` hold the line, and
 * `nonsense` is the judge the tests run every decision through.
 */
export interface GamePlan {
  /** percentage points added to (negative: taken off) the pass rate, -15..15 */
  passRate: number;
  /** go-for-it tendency on fourth down inside the opponent's 20, -100 (never) .. 100 (always) */
  fourthRedZone: number;
  /** ... in the opponent's territory outside the red zone */
  fourthOpp: number;
  /** ... in the team's own territory */
  fourthOwn: number;
  /** blitz rate, -100 (never) .. 100 (every down) */
  blitz: number;
  /** share of snaps in 11 / 12 / 13 personnel, in percent, summing to 100 */
  p11: number;
  p12: number;
  p13: number;
  /** share of runs the second back takes, 0..50 (a workhorse to a 50-50 committee) */
  rbCommittee: number;
  /** quarterback scrambles and keepers: -100 (stay in the pocket) .. 100 (run him) */
  qbRun: number;
  /** two-point tries: -100 (kick unless the clock demands it) .. 100 (go whenever it is sensible) */
  twoPoint: number;
  /** fourth and short (1-3 yards), added to the zone dial: -100 .. 100 */
  fourthShort: number;
  /** fourth and long (7+ yards), added to the zone dial: -100 .. 100 */
  fourthLong: number;
  /** kickoffs: -100 (pin them, kick it short and cover) .. 100 (kick it deep for the touchback) */
  kickoff: number;
  /** returns: -100 (fair catch, take the touchback) .. 100 (bring everything back) */
  returns: number;
  /** rookies: -100 (veterans first) .. 100 (play the rookies ahead of near-equal veterans) */
  rookies: number;
}

export const DEFAULT_PLAN: Readonly<GamePlan> = {
  passRate: 0,
  fourthRedZone: 0,
  fourthOpp: 0,
  fourthOwn: 0,
  blitz: 0,
  p11: 60,
  p12: 30,
  p13: 10,
  rbCommittee: 35,
  qbRun: 0,
  twoPoint: 0,
  fourthShort: 0,
  fourthLong: 0,
  kickoff: 0,
  returns: 0,
  rookies: 0,
};

const clampTo = (x: unknown, lo: number, hi: number, fallback: number): number =>
  typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : fallback;

/** A plan from anything, every dial clamped and the personnel mix made to sum to 100. */
export function cleanPlan(input: Partial<GamePlan> | null | undefined): GamePlan {
  const p = { ...DEFAULT_PLAN, ...(input ?? {}) };
  const out: GamePlan = {
    passRate: Math.round(clampTo(p.passRate, -15, 15, 0)),
    fourthRedZone: Math.round(clampTo(p.fourthRedZone, -100, 100, 0)),
    fourthOpp: Math.round(clampTo(p.fourthOpp, -100, 100, 0)),
    fourthOwn: Math.round(clampTo(p.fourthOwn, -100, 100, 0)),
    blitz: Math.round(clampTo(p.blitz, -100, 100, 0)),
    p11: clampTo(p.p11, 0, 100, 60),
    p12: clampTo(p.p12, 0, 100, 30),
    p13: clampTo(p.p13, 0, 100, 10),
    rbCommittee: Math.round(clampTo(p.rbCommittee, 0, 50, 35)),
    qbRun: Math.round(clampTo(p.qbRun, -100, 100, 0)),
    twoPoint: Math.round(clampTo(p.twoPoint, -100, 100, 0)),
    fourthShort: Math.round(clampTo(p.fourthShort, -100, 100, 0)),
    fourthLong: Math.round(clampTo(p.fourthLong, -100, 100, 0)),
    kickoff: Math.round(clampTo(p.kickoff, -100, 100, 0)),
    returns: Math.round(clampTo(p.returns, -100, 100, 0)),
    rookies: Math.round(clampTo(p.rookies, -100, 100, 0)),
  };
  const sum = out.p11 + out.p12 + out.p13;
  if (sum <= 0) return { ...out, p11: DEFAULT_PLAN.p11, p12: DEFAULT_PLAN.p12, p13: DEFAULT_PLAN.p13 };
  out.p11 = Math.round((out.p11 / sum) * 100);
  out.p12 = Math.round((out.p12 / sum) * 100);
  out.p13 = 100 - out.p11 - out.p12;
  return out;
}

export function isDefaultPlan(p: GamePlan | null | undefined): boolean {
  if (!p) return true;
  return (Object.keys(DEFAULT_PLAN) as (keyof GamePlan)[]).every((k) => p[k] === DEFAULT_PLAN[k]);
}

/** Logit change per percentage point on the pass rate (the league passes ~60%: 1 / (0.6 x 0.4) / 100). */
const PASS_LOGIT_PER_POINT = 1 / (0.6 * 0.4) / 100;
/** The most the fourth-down dial moves the go-for-it logit. */
const FOURTH_LOGIT_AT_MAX = 1.8;

export type FourthZone = "redZone" | "opp" | "own";

/** Where the ball is, for the fourth-down dials. `yardline100` is distance to the opponent's end zone. */
export function fourthZone(yardline100: number): FourthZone {
  return yardline100 <= 20 ? "redZone" : yardline100 <= 50 ? "opp" : "own";
}

/** How much of the fourth-and-short dial applies at this distance: all of it at a yard, none past four. */
export function shortWeight(ydstogo: number): number {
  return ydstogo <= 1 ? 1 : ydstogo <= 2 ? 0.8 : ydstogo <= 3 ? 0.5 : ydstogo <= 4 ? 0.2 : 0;
}
/** ... and the fourth-and-long dial: all of it at ten, none at six or less. */
export function longWeight(ydstogo: number): number {
  return ydstogo >= 10 ? 1 : ydstogo >= 9 ? 0.75 : ydstogo >= 8 ? 0.5 : ydstogo >= 7 ? 0.25 : 0;
}

/** The go-for-it logit shift: where the ball is, and (when given) how far there is to go. */
export function fourthDelta(plan: GamePlan, yardline100: number, ydstogo?: number): number {
  const z = fourthZone(yardline100);
  let dial = z === "redZone" ? plan.fourthRedZone : z === "opp" ? plan.fourthOpp : plan.fourthOwn;
  if (ydstogo !== undefined) dial += plan.fourthShort * shortWeight(ydstogo) + plan.fourthLong * longWeight(ydstogo);
  return (Math.max(-130, Math.min(130, dial)) / 100) * FOURTH_LOGIT_AT_MAX;
}

// ---- keeping decisions sane --------------------------------------------------

/** The longest field goal a coach sends the kicker out for (the line of scrimmage plus 18). */
export const FIELD_GOAL_LIMIT = 62;

export interface FourthCtx {
  ydstogo: number;
  yardline100: number;
  qtr: number;
  /** seconds left in the game */
  gsr: number;
  /** the offence's lead (negative: trailing) */
  diff: number;
}

/** A team that is behind late and has the ball needs points, whatever its plan says. */
export function lateAndTrailing(c: Pick<FourthCtx, "qtr" | "gsr" | "diff">): boolean {
  return c.diff < 0 && c.qtr >= 4 && c.gsr <= 360;
}

/**
 * What the plan may do to a fourth-down call. A positive push never talks a
 * team into going for it from where nobody would (a long way to go, or deep
 * in its own end) and a negative one never talks a team trailing late into
 * punting when it has to score. The engine's own odds decide everything else.
 */
export function fourthSane(delta: number, c: FourthCtx): number {
  if (delta > 0) {
    if (lateAndTrailing(c)) return c.ydstogo >= 20 ? 0 : delta;
    if (c.ydstogo >= 15) return 0;
    if (c.ydstogo >= 11 && c.yardline100 > 40) return 0;
    if (c.yardline100 >= 80) return 0;
    if (c.yardline100 >= 70 && c.ydstogo > 3) return 0;
    return delta;
  }
  if (delta < 0 && lateAndTrailing(c) && c.ydstogo <= 10) return 0;
  return delta;
}

// ---- two-point tries ---------------------------------------------------------

/**
 * The standard chart: after a touchdown, with `diff` the scorer's lead before
 * the try (so -2 is trailing by two), when a try for two is the percentage
 * play. Late in the game only; the points a team needs decide it.
 */
export function twoPointChart(diff: number, qtr: number, gsr: number): boolean {
  if (qtr < 4 && gsr > 1200) return false;
  return diff === -2 || diff === -5 || diff === -10 || diff === 1 || diff === 5 || diff === 8;
}

/** Odds a two-point try is converted: the league's, nudged by how good the offence is. */
export function twoPointOdds(grades: { pass: number; run: number }): number {
  return Math.max(0.36, Math.min(0.58, 0.47 + 0.02 * ((grades.pass + grades.run) / 2)));
}

/**
 * The chance a team goes for two. The chart is the base; the dial widens or
 * narrows it. In the last two minutes the chart alone decides, and the plan
 * can never make a team kick when a tie is on the line or run up a lead.
 */
export function twoPointProb(plan: GamePlan | null, c: { diff: number; qtr: number; gsr: number }): number {
  // the standard plan is the engine as it was: kick the point (the caller's legacy path)
  if (!plan || plan.twoPoint === 0 || c.qtr >= 5) return 0;
  const chart = twoPointChart(c.diff, c.qtr, c.gsr);
  // the last two minutes: the chart alone, whatever the dial
  if (c.qtr >= 4 && c.gsr <= 120) return chart ? 1 : 0;
  // a lead nobody is chasing: kick
  if (c.diff >= 17) return 0;
  const a = plan.twoPoint / 100;
  // timid: kick everything, but trailing by two with the game on the line is not the place for it
  if (a < 0) return c.diff === -2 && c.qtr >= 4 && c.gsr <= 600 ? 1 : 0;
  // aggressive: the chart, more and more of it; then the second half at any score, the first a little and only close ones
  if (chart) return Math.min(1, 2 * a);
  if (c.qtr >= 3) return Math.min(1, 0.7 * a);
  return Math.abs(c.diff) <= 8 ? 0.3 * a : 0;
}

// ---- the quarterback's legs --------------------------------------------------

/**
 * What running the quarterback does, given how athletic he is (`mobility`, a
 * z-score: Lamar Jackson ~ +1.8, Kirk Cousins ~ -1.6). More scrambles for
 * anyone; what they are worth is the quarterback's. A mobile one escapes
 * pressure and picks up yards, an immobile one takes the sack and loses them.
 * Staying in the pocket (a < 0) is the same trade the other way round.
 */
export function qbRunEffect(plan: GamePlan, mobility: number): {
  scramble: number;
  sack: number;
  scrambleYards: number;
  keeperShare: number;
  keeperYards: number;
} {
  const a = plan.qbRun / 100;
  return {
    scramble: 0.9 * a,
    sack: -0.15 * a * mobility,
    scrambleYards: Math.max(a, 0) * (1.7 * mobility - 1.3),
    keeperShare: Math.max(a, 0) * 0.15,
    keeperYards: 2.0 * mobility - 0.8,
  };
}

// ---- kickoffs and returns ------------------------------------------------------

/**
 * The kicking team's dial, with the kicker's leg (`kickerZ`). Deep (k > 0)
 * goes for the touchback and risks sailing it out of bounds; pinned (k < 0)
 * kicks short and covers: the ball comes back more often, to a worse spot
 * the better the leg, and the return is a live ball.
 */
export function kickoffEffect(k: number, kickerZ: number): { touchback: number; spotShift: number; tdMult: number; outOfBounds: number } {
  const a = k / 100;
  return {
    touchback: a > 0 ? 0.28 * a * (1 + 0.2 * kickerZ) : 0.4 * a,
    spotShift: a < 0 ? a * (1.2 + 1.6 * kickerZ) : 0,
    tdMult: a < 0 ? 1 - 1.2 * a : 1,
    outOfBounds: a > 0 ? 0.05 * a * Math.max(0.2, 1 - 0.4 * kickerZ) : 0,
  };
}

/**
 * The receiving team's dial, with the returner's speed and moves (`returnerZ`).
 * Returning everything (r > 0) turns touchbacks into returns out of the end
 * zone and pushes punt returns further: good for a dangerous returner, bad for
 * a slow one. Fair catching (r < 0) takes the knee and the safe yard: no
 * big returns and no fumbles, and no touchdowns either.
 */
export function returnEffect(r: number, returnerZ: number): {
  touchbackToReturn: number;
  fairCatch: number;
  returnYards: number;
  tdMult: number;
} {
  const a = r / 100;
  return {
    touchbackToReturn: a > 0 ? 0.5 * a : 0,
    fairCatch: a < 0 ? -0.6 * a : 0,
    returnYards: a > 0 ? a * (2.4 * returnerZ - 0.5) : 0,
    tdMult: a > 0 ? Math.max(0.2, 1 + a * (0.9 * returnerZ + 0.2)) : 1,
  };
}

// ---- rookies -----------------------------------------------------------------

/** The most overall points a rookie can be behind a veteran and still start ahead of him. */
export const ROOKIE_MARGIN = 4;

/** A rookie's development at training camp from the policy: playing time is how young players grow (and sitting is how they don't). */
export function rookieDevelopment(dial: number, p: { years_pro?: number | undefined; overall: number; potential?: number | undefined }): number {
  if (!dial || (p.years_pro ?? 9) > 1) return 0;
  const a = dial / 100;
  const room = p.potential === undefined ? 1 : p.potential > p.overall ? 1 : 0.35;
  return a > 0 ? a * 1.2 * room : a * 0.7;
}

// ---- the judge ---------------------------------------------------------------

/** A decision the plan had a hand in, as the engine records it for the tests. */
export type DecisionRecord =
  | { kind: "fourth"; act: "GO" | "PUNT" | "FG"; ydstogo: number; yardline100: number; qtr: number; gsr: number; diff: number }
  | { kind: "two"; go: boolean; diff: number; qtr: number; gsr: number }
  | { kind: "fair_catch"; qtr: number; gsr: number; diff: number };

/**
 * Whether a decision is one no coach would make: null if it passes, the
 * reason if it does not. This is deliberately a separate statement of the
 * rules from the guards that prevent them, so a bug in either shows up.
 */
export function nonsense(d: DecisionRecord): string | null {
  if (d.kind === "fourth") {
    const trailingLate = d.diff < 0 && d.qtr >= 4 && d.gsr <= 360;
    if (d.act === "GO") {
      if (d.ydstogo >= 15 && !trailingLate) return `going for it on fourth and ${Math.round(d.ydstogo)}`;
      if (d.yardline100 >= 85 && !trailingLate) return `going for it from own ${100 - Math.round(d.yardline100)}`;
    }
    if (d.act === "FG" && d.yardline100 + 18 > FIELD_GOAL_LIMIT + 3) return `a ${Math.round(d.yardline100 + 18)}-yard field goal`;
    if (d.act === "PUNT") {
      if (d.yardline100 <= 30 && d.ydstogo <= 3 && d.qtr === 4 && d.diff < -8 && d.gsr <= 360) return "punting inside the 30 down two scores late";
    }
    return null;
  }
  if (d.kind === "two") {
    if (d.go && d.diff >= 17) return "going for two with a lead of 17 or more";
    if (!d.go && d.diff === -2 && d.qtr >= 4 && d.gsr <= 120) return "kicking the extra point down two with the game on the line";
    return null;
  }
  if (d.kind === "fair_catch") {
    if (d.diff < 0 && d.qtr >= 4 && d.gsr <= 120) return "fair catching trailing in the last two minutes";
    return null;
  }
  return null;
}

/** What the mix of personnel does, relative to the league's usual mix. All in the channel's own units. */
export function personnelDelta(plan: GamePlan): { pass: number; complete: number; sack: number; rush: number } {
  const d12 = (plan.p12 - DEFAULT_PLAN.p12) / 100;
  const d13 = (plan.p13 - DEFAULT_PLAN.p13) / 100;
  return {
    // heavier sets run more
    pass: -0.5 * d12 - 1.1 * d13,
    // and a tight end in a receiver's place catches less
    complete: -0.18 * d12 - 0.5 * d13,
    // an extra blocker holds the rush off
    sack: -0.14 * d12 - 0.35 * d13,
    // and opens the run
    rush: 0.45 * d12 + 0.9 * d13,
  };
}

/**
 * What the tight ends do with the extra snaps a heavy mix gives them, relative
 * to the league's usual mix. The flat terms in `personnelDelta` are an average
 * tight end; a heavy package is only as good as the men in it.
 *
 *  - `blocking`: how good the tight ends are as blockers (z). Each extra tight
 *    end on the field adds that much to the run game and holds the rush off
 *  - `receivingGap`: the second tight end's receiving z minus the receiver he
 *    replaces. A better catcher than the third receiver makes 12 personnel a
 *    passing package; a worse one makes it a cost
 */
export function personnelQuality(
  plan: GamePlan,
  q: { blocking: number; receivingGap: number },
): { complete: number; sack: number; rush: number } {
  const d12 = (plan.p12 - DEFAULT_PLAN.p12) / 100;
  const d13 = (plan.p13 - DEFAULT_PLAN.p13) / 100;
  // tight ends added to the field (12 adds one, 13 two), and receivers taken off it
  const extra = d12 + 2 * d13;
  return {
    rush: extra * 0.3 * q.blocking,
    sack: -extra * 0.07 * q.blocking,
    complete: extra * 0.12 * q.receivingGap,
  };
}

/**
 * What leaning hard one way costs, and what it pays.
 *
 * A defense plays the tendency it sees. A team that throws far more than the
 * league has its receivers doubled and the rush pinned back (completions fall
 * a little for every point past the norm); one that runs far more sees an
 * extra man in the box (yards a carry fall). That is the price of the style.
 * What it buys is the offence's own strengths used more: a passing plan pays
 * to the extent the quarterback, receivers and protection are good, a running
 * plan to the extent the back and the line are. So a style is worth it on a
 * roster built for it, and costs on one that is not.
 *
 * `grades` are z-scores (`styleGrades` in synergy.ts). Zero for the standard plan.
 */
export function leanDelta(plan: GamePlan, grades: { pass: number; run: number }): { complete: number; rush: number } {
  const d = plan.passRate;
  if (d > 0) return { complete: d * (-0.014 + 0.007 * grades.pass), rush: 0.008 * d };
  if (d < 0) return { complete: 0, rush: -d * (-0.010 + 0.045 * grades.run) };
  return { complete: 0, rush: 0 };
}

export function passLogit(plan: GamePlan): number {
  return plan.passRate * PASS_LOGIT_PER_POINT + personnelDelta(plan).pass;
}

/**
 * The plan a CPU team plays with, by the strategy its GM follows (the ids in
 * `ui-source/src/state/aiStrategy.ts`): the same personality as the roster it
 * builds, on the field. `analysis/42_strategy_tournament.ts` plays every one of
 * these on every real roster against the standard plan, and they are tuned so a
 * style pays on a roster built for it and costs on one that is not, with no
 * style better than the standard plan across the league.
 */
export const STRATEGY_PLANS: Record<string, Partial<GamePlan>> = {
  balanced: {},
  offense_heavy: { passRate: 3, fourthOpp: 30, fourthRedZone: 30, fourthShort: 25, twoPoint: 20 },
  defense_heavy: { blitz: 55 },
  pass_heavy: { passRate: 8, p11: 72, p12: 22, p13: 6, rbCommittee: 40 },
  run_heavy: { passRate: -8, p11: 46, p12: 38, p13: 16, rbCommittee: 20 },
  high_floor: { passRate: -6, fourthOwn: -15, twoPoint: -30, p11: 48, p12: 38, p13: 14, rbCommittee: 25 },
  high_ceiling: { fourthRedZone: 30, fourthOpp: 30, fourthOwn: 10, fourthShort: 30, twoPoint: 40, blitz: 20 },
  trenches_first: { passRate: -4, p11: 50, p12: 36, p13: 14, blitz: 20, fourthShort: 30, rbCommittee: 30 },
};
