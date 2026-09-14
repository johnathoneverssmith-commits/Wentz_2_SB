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
 * And **the engine has no home-field advantage.** The fitted intercept came
 * out at -0.013 — 49.7% for an even matchup — and that residue is fully
 * explained by something other than home field: 1.0% of games end tied, and a
 * tie is not a home win, which pulls an even matchup from 0.500 to about
 * 0.495 and the log-odds to about -0.02. So the intercept is set to exactly
 * zero here, both because nothing in 7,980 even matchups argues for anything
 * else and because a non-zero one would make the curve asymmetric: two teams
 * would each be a 49.7% favourite over the other.
 *
 * That the engine has no home field is a real gap against the NFL, where home
 * teams win about 55%, and it is worth being precise about whose gap it is —
 * it belongs to the *engine*, not to this file. Showing 54% because the old
 * formula assumed a home edge was the UI telling the player something about a
 * game the simulator was never going to honour. So the curve reports what the
 * sim does; adding a home-field term to the engine would shift every result
 * it has been validated against, and that is a decision for the engine rather
 * than for a tooltip.
 *
 * The fit is very slightly optimistic at the extremes — the +12 bucket
 * measured 77.8% where the logistic says 84.8%, on 324 games — so the widest
 * gaps are clamped rather than extrapolated.
 */

/**
 * Home-field advantage: none, measured. See the header — the -0.013 the fit
 * returned is the tie rate, not an edge, and zero keeps the curve symmetric.
 */
const A = 0;

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

/**
 * Chance the first team beats the second, as a percentage, 1–99.
 *
 * `homeEdge` exists for callers that want to reflect a home-field advantage
 * the engine doesn't model; the default is the measured zero. Leave it alone
 * unless the engine grows one.
 */
export function winProbability(
  teamOverall: number,
  opponentOverall: number,
  homeEdge = 0,
): number {
  if (!Number.isFinite(teamOverall) || !Number.isFinite(opponentOverall)) return 50;
  const gap = Math.max(-MEASURED_TO, Math.min(MEASURED_TO, teamOverall - opponentOverall));
  const p = 1 / (1 + Math.exp(-(A + homeEdge + B * gap)));
  return Math.max(1, Math.min(99, Math.round(p * 100)));
}

/** The same curve as a 0–1 probability, for code that samples an outcome. */
export function winChance(teamOverall: number, opponentOverall: number): number {
  return winProbability(teamOverall, opponentOverall) / 100;
}
