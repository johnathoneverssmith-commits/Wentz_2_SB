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
 * The three fourth-down dials don't apply in the last two minutes of the game,
 * where the clock decides what a team does and not the plan.
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

export function fourthDelta(plan: GamePlan, yardline100: number): number {
  const z = fourthZone(yardline100);
  const dial = z === "redZone" ? plan.fourthRedZone : z === "opp" ? plan.fourthOpp : plan.fourthOwn;
  return (dial / 100) * FOURTH_LOGIT_AT_MAX;
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

export function passLogit(plan: GamePlan): number {
  return plan.passRate * PASS_LOGIT_PER_POINT + personnelDelta(plan).pass;
}
