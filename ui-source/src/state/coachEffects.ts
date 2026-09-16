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

/** One percent per point, as a plain multiplier around 1. */
function swing(overall: number): number {
  return (overall - NEUTRAL_COACH_OVERALL) / 100;
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

/**
 * How long an injury keeps a player out, as a share of what the injury
 * engine generated. Better medical staff, shorter absence.
 *
 * Note this is recovery *duration* only. It does not make anybody less likely
 * to get hurt — the injury engine decides that on its own, and a training
 * room that prevented injuries would be doing a different job.
 */
export function recoveryMultiplier(overall: number): number {
  return Math.max(0.1, 1 - swing(overall));
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
  return {
    development: developmentMultiplier(overall),
    regression: regressionMultiplier(overall),
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
): number {
  if (delta === 0) return 0;
  const scaled = delta > 0 ? delta * mods.development : delta * mods.regression;
  const rounded = Math.round(scaled);
  if (rounded !== 0) return rounded;
  return delta > 0 ? 1 : -1;
}
