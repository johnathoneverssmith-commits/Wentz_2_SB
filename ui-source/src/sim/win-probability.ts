/**
 * What a rating gap is worth, measured against the engine.
 *
 * The number this produces is shown before a game on the team hub and in the
 * matchup panel, and beside every unplayed bracket game. Until now it came
 * from a formula somebody reasoned their way to — `0.5 + 0.02 * gap + 4%
 * home edge` — which had never been checked against a single simulated game.
 * It was wrong in both directions at once.
 *
 * `analysis/30_win_probability.ts` ran the engine over **47,616 games**: every
 * ordered pair of the 32 real rosters, three seeds each, plus weakened copies
 * of every roster so the measurement covers the gaps a franchise four years
 * in actually produces (the real league spans about eight rating points; the
 * fit covers sixteen). Injuries on, no coaching layer — the same options the
 * franchise adapter runs, because a curve fitted to a different sim than the
 * game plays would be worse than no curve at all.
 *
 *     P(home win) = 1 / (1 + exp(-(A + B * gap)))
 *
 * where `gap` is the two teams' starting-lineup mean `overall`, the number
 * the UI already calls team overall.
 *
 * **Two things it found.**
 *
 * A rating point is worth far more than the old formula said. `B = 0.147`
 * means a ten-point edge is an 81% favourite; the old line said 74%, and at
 * the other end called a twelve-point underdog a 30% chance when the engine
 * says 16%. Mean absolute error against the measured curve: 0.007, against
 * the old formula 0.064.
 *
 * **Where the home team comes in.** The first version of this file reported
 * an intercept of zero and said so loudly, because the engine genuinely had
 * no home-field advantage — a real gap against a league where the home team
 * wins 54% of the time. That gap is now closed in the engine itself
 * (`src/engine/home-field.ts`, `docs/decisions.md` → OQ-10), so the curve has
 * a venue term again. The difference from the formula this replaced is that
 * the number is measured rather than assumed, and that the engine will
 * actually honour it.
 *
 * The fit is very slightly optimistic at the extremes — the +12 bucket
 * measured 77.8% where the logistic says 84.8%, on 324 games — so the widest
 * gaps are clamped rather than extrapolated.
 */

/**
 * Log-odds the home team gets, and the visitor gives up.
 *
 * The league's own figure over the 2018-2025 regular seasons the engine is
 * calibrated against: 2,127 games, 54.02% won by the home team (ties as half)
 * — `analysis/31_home_field.py`. The engine is fitted to reproduce it and
 * measures 53.97% over 19,840 simulated games, so quoting the league's number
 * and quoting the simulator's are the same thing to two decimal places.
 *
 * A neutral site gets zero, which is what the Super Bowl is.
 */
const HOME_EDGE = 0.1611;

/** Per point of starting-lineup overall. */
const B = 0.1467;

/**
 * The widest gap the measurement covers with enough games to trust.
 *
 * Beyond it the logistic keeps climbing and the data does not, so the answer
 * is pinned rather than extrapolated: a 25-point mismatch is not meaningfully
 * more certain than an 18-point one, and claiming 99% would be a promise the
 * engine doesn't keep.
 */
const MEASURED_TO = 14;

/** Where the first team is playing. The Super Bowl is the neutral one. */
export type Venue = "home" | "away" | "neutral";

/**
 * Chance the first team beats the second, as a percentage, 1–99.
 *
 * `venue` is where the *first* team is playing, so a matchup asked both ways
 * gives answers that add to 100.
 */
export function winProbability(
  teamOverall: number,
  opponentOverall: number,
  venue: Venue = "neutral",
): number {
  if (!Number.isFinite(teamOverall) || !Number.isFinite(opponentOverall)) return 50;
  const gap = Math.max(-MEASURED_TO, Math.min(MEASURED_TO, teamOverall - opponentOverall));
  const edge = venue === "home" ? HOME_EDGE : venue === "away" ? -HOME_EDGE : 0;
  const p = 1 / (1 + Math.exp(-(edge + B * gap)));
  return Math.max(1, Math.min(99, Math.round(p * 100)));
}

/** The same curve as a 0–1 probability, for code that samples an outcome. */
export function winChance(
  teamOverall: number,
  opponentOverall: number,
  venue: Venue = "neutral",
): number {
  return winProbability(teamOverall, opponentOverall, venue) / 100;
}
