import type { Coach, DevelopmentRole, LeagueState } from "@/domain";
import { coachRoleForPosition } from "@/domain";

/**
 * What the nine development coaches actually do.
 *
 * They never touch a play. A game is simulated by the engine from rosters and
 * the three real staff members; these nine work in the gaps between seasons,
 * on how fast a player gets better, how fast he falls off, and how long an
 * injury keeps him out.
 *
 * The scale is deliberately plain: 72 is neutral, and every point either side
 * moves the relevant rate by one percent. A 92 quarterbacks coach develops
 * his room twenty percent faster than a neutral one and slows their decline
 * by twenty percent; a 52 does the reverse. That symmetry is the point — the
 * same distance from neutral is worth the same amount whichever way it runs,
 * so a bad hire costs what a good one gains.
 *
 * What a coach cannot do is change *when* a career turns. Development and
 * regression are decided by the existing aging model from age and position;
 * a coach only scales the size of the move. A great coach does not keep a
 * 34-year-old improving, and a poor one does not start a 24-year-old
 * declining early.
 */

/** The rating at which a coach changes nothing. */
export const NEUTRAL_COACH_OVERALL = 72;

/**
 * How a coach's rating becomes a fraction of a player's yearly move.
 *
 * Inside `INNER_POINTS` of neutral every point is worth 1.5% (what the
 * Aging + Training Camp optimization pass chose so the effect survives integer
 * rounding). Past it a point is worth less: an elite coach is still clearly
 * better than a good one, but a staff of eight 95s no longer adds up to more
 * than the roster they coach. Measured in `docs/AUDIT_player_development_coaching.md`
 * and `docs/PD1_coaching_calibration.md`.
 */
export const COACH_TUNING = {
  INNER_POINTS: 12,
  INNER_SWING_PER_OVR: 0.012,
  OUTER_SWING_PER_OVR: 0.004,
  /** The head coach sets the program for every position group: a smaller slope than a position coach, on all of them. */
  HEAD_COACH_SWING_PER_OVR: 0.006,
  /** However good the staff, a player keeps at least this share of a decline and gains at most this multiple of a gain. */
  MIN_REGRESSION: 0.55,
  MAX_DEVELOPMENT: 1.4,
};

/** One point of OVR either side of neutral, as a plain fraction, with the diminishing outer slope. */
function swing(overall: number): number {
  const d = overall - NEUTRAL_COACH_OVERALL;
  const t = COACH_TUNING;
  const inner = Math.min(Math.abs(d), t.INNER_POINTS) * t.INNER_SWING_PER_OVR;
  const outer = Math.max(0, Math.abs(d) - t.INNER_POINTS) * t.OUTER_SWING_PER_OVR;
  return Math.sign(d) * (inner + outer);
}

/**
 * How much of a player's gain this coach delivers. Better coach, bigger gain.
 */
export function developmentMultiplier(overall: number): number {
  return Math.max(0, 1 + swing(overall));
}

/**
 * How much of a player's decline lands. Better coach, smaller decline — so
 * the multiplier moves the opposite way from development.
 */
export function regressionMultiplier(overall: number): number {
  return Math.max(0, 1 - swing(overall));
}

/** The head coach's share, applied on top of the position coach to every player on the team. */
export function programSwing(headCoachRating: number): number {
  return (headCoachRating - NEUTRAL_COACH_OVERALL) * COACH_TUNING.HEAD_COACH_SWING_PER_OVR;
}

/** The head coach's rating as the staff screens show it: game management and discipline. */
export function headCoachRating(c: Coach | undefined): number {
  if (!c) return NEUTRAL_COACH_OVERALL;
  return Math.round(((c.gameManagement ?? NEUTRAL_COACH_OVERALL) + (c.discipline ?? NEUTRAL_COACH_OVERALL)) / 2);
}

/**
 * Medical staff's recovery-duration slope. Kept at the plain 1% development
 * and regression used before the optimization pass raised those to 1.5% —
 * recovery scales *weeks*, where even 1% is visible after the week rounds,
 * so reusing 1.5% here would let an elite medical staff cut an ordinary
 * injury timeline by closer to 40% than the intended third.
 */
const MEDICAL_SWING_PER_OVR = 0.01;

/**
 * How long an injury keeps a player out, as a share of what the injury
 * engine generated. Better medical staff, shorter absence.
 *
 * Note this is recovery *duration* only. It does not make anybody less likely
 * to get hurt — the injury engine decides that on its own, and a training
 * room that prevented injuries would be doing a different job.
 *
 * Bounded both ways (0.65-1.35): a true season-ending injury should stay
 * season-ending even for an elite staff, and a poor staff should slow
 * recovery without making an ordinary injury open-ended.
 */
export function recoveryMultiplier(overall: number): number {
  const raw = 1 - (overall - NEUTRAL_COACH_OVERALL) * MEDICAL_SWING_PER_OVR;
  return Math.min(1.35, Math.max(0.65, raw));
}

/** The staff member on `teamCode` who holds `role`, if anybody does. */
export function staffAt(s: LeagueState, teamCode: string, role: DevelopmentRole): Coach | undefined {
  return Object.values(s.coaches).find((c) => c.team === teamCode && c.role === role);
}

/**
 * The development and regression multipliers for one player on one team.
 *
 * A vacant job is neutral rather than punishing: a team that somehow reaches
 * a season without a receivers coach should develop its receivers the way the
 * aging model says, not worse. Positions nobody coaches — long snappers do
 * not exist here, but the lookup is honest about the general case — are
 * neutral for the same reason.
 */
export function coachModifiersFor(
  s: LeagueState,
  teamCode: string,
  position: string,
): { development: number; regression: number; coach: Coach | undefined } {
  const role = coachRoleForPosition(position);
  if (!role) return { development: 1, regression: 1, coach: undefined };
  const coach = staffAt(s, teamCode, role);
  const overall = coach?.overall ?? NEUTRAL_COACH_OVERALL;
  const program = programSwing(headCoachRating(Object.values(s.coaches).find((c) => c.team === teamCode && c.role === "HC")));
  return {
    development: Math.min(COACH_TUNING.MAX_DEVELOPMENT, Math.max(0, developmentMultiplier(overall) + program)),
    regression: Math.max(COACH_TUNING.MIN_REGRESSION, regressionMultiplier(overall) - program),
    coach,
  };
}

/** Recovery scaling for a team, from whoever is running its training room. */
export function recoveryScaleFor(s: LeagueState, teamCode: string): number {
  const med = staffAt(s, teamCode, "MED");
  return recoveryMultiplier(med?.overall ?? NEUTRAL_COACH_OVERALL);
}

/**
 * Apply a coach to one already-decided rating change.
 *
 * The sign of `delta` is what decides which multiplier applies, because the
 * aging model has already made the call about whether this player is still
 * climbing. Rounding happens here rather than at the call site so a change
 * that survives the multiplier never rounds away to nothing: a player the
 * model said improved still improves by at least a point.
 */
export function applyCoachToDelta(
  delta: number,
  mods: { development: number; regression: number },
  roll?: number,
): number {
  if (delta === 0) return 0;
  const scaled = delta > 0 ? delta * mods.development : delta * mods.regression;
  if (roll !== undefined) return roundBy(scaled, roll);
  const rounded = Math.round(scaled);
  if (rounded !== 0) return rounded;
  return delta > 0 ? 1 : -1;
}

/**
 * Round `x` to an integer with a uniform `roll` in [0, 1): up with probability
 * equal to its fractional part, so the expected value is `x` itself and a whole
 * number never moves. Plain rounding turned a 7% effect on a +2 into nothing
 * and a 30% one into a flat +1, so small effects vanished and large ones came
 * in steps. The roll is the player's own seeded draw, so a retry is the same camp.
 * Never changes the sign of `x`.
 */
export function roundBy(x: number, roll: number): number {
  return x >= 0 ? Math.floor(x + roll) : -Math.floor(-x + roll);
}
