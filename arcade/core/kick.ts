/** Kicking: a deterministic accuracy meter driven by simulation ticks. No random numbers, no wall-clock time. */
export const KICK_PERIOD_TICKS = 100;
/** The meter swings on its own; if nobody presses Kick it locks where it is after this long. */
export const KICK_MAX_TICKS = 2 * KICK_PERIOD_TICKS;
export const EXTRA_POINT_DISTANCE = 25;
/** Yards from the goal line to the kicker: ten of end zone plus the snap and hold. */
export const KICK_EXTRA_YARDS = 17;
export const FIELD_GOAL_MAX_DISTANCE = 57;
export const EXTRA_POINT_POINTS = 1;
export const FIELD_GOAL_POINTS = 3;
/**
 * Meter position in [-1, 1] after `ticks`: it starts at the right end (+1), crosses the centre at a quarter
 * period, reaches -1 at half a period and comes back. Pressing while it is near 0 is an accurate kick.
 */
export function meterAt(ticks: number): number {
    const phase = (ticks % KICK_PERIOD_TICKS) / KICK_PERIOD_TICKS;
    return Math.abs(4 * phase - 2) - 1;
}
/** How far from the centre the meter may be and still be good: wider for short kicks, narrower for long ones. */
export function kickTolerance(distance: number): number {
    return Math.min(0.6, Math.max(0.22, 0.8 - 0.0095 * distance));
}
export const isGood = (ticks: number, distance: number): boolean => Math.abs(meterAt(ticks)) <= kickTolerance(distance) + 1e-9;
export const kickDistance = (yardsToGoal: number): number => yardsToGoal + KICK_EXTRA_YARDS;
