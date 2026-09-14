/**
 * Home-field advantage, measured rather than asserted (OQ-10).
 *
 * The engine used to give the home team nothing. Over 47,616 simulated games
 * an even matchup was a coin flip to within noise, and what little residual
 * there was turned out to be the tie rate, not an edge. The real league is
 * not like that: over the 2018-2025 regular seasons the engine is calibrated
 * against — 2,127 games — the home team wins **54.02%** of the time (ties as
 * half) by a mean margin of **+1.57 points**.
 *
 * `analysis/31_home_field.py` measures both that and, more usefully, *where*
 * in a game the advantage shows up, by splitting each channel on
 * `posteam_type`. Every one of them favours the home offense, which is what
 * makes this worth modelling as a mechanism rather than a thumb on the score:
 *
 * | channel | home | away |
 * |---|---|---|
 * | completion rate | 0.60811 | 0.59647 |
 * | sack rate per dropback | 0.06196 | 0.06473 |
 * | interception rate per dropback | 0.01999 | 0.02056 |
 * | field goals made | 0.85023 | 0.84177 |
 * | yards per carry | 4.557 | 4.496 |
 * | pre-snap fouls per play | 0.01857 | 0.01964 |
 *
 * Two of those readings are worth pausing on. Field-goal *distance* attempted
 * is 39.15 at home against 39.21 away — all but identical — so the kicking
 * gap is kickers actually kicking better, not an easier set of attempts. And
 * the foul gap is almost entirely pre-snap: subtract those and the live-ball
 * rate differs by 0.7%, which is nothing. That is the crowd-noise story
 * showing up exactly where the story says it should, in the snap count.
 *
 * ## The split is symmetric, and that is the point
 *
 * Each channel's home-away difference is halved and applied as `+half` to the
 * home offense and `-half` to the away one. The league average therefore does
 * not move: every team plays half its games at home, so anything §22 measures
 * league-wide sees the same numbers it saw before. This buys the home/away
 * asymmetry without spending any of the calibration.
 *
 * ## The scale came out at one
 *
 * `HOME_FIELD_SCALE` multiplies all of it, and exists so the size of the
 * effect could be fitted against the one number nobody can argue with — how
 * often the home team actually wins. `analysis/32_fit_home_field.ts` swept it
 * over every ordered pair of the 32 teams, ~4,000 games a point:
 *
 * | scale | home win % | mean margin | points/team-game |
 * |---|---|---|---|
 * | 0 | 50.18% | +0.13 | 20.84 |
 * | 2 | 57.27% | +2.53 | 20.82 |
 * | 4 | 62.51% | +4.31 | 20.84 |
 *
 * Solving that for the league's 54.02% suggested about 1.02, and a proper
 * check at scale 1 over **19,840 games** returned 53.62% — 0.40pp low, which
 * is 1.1 standard errors and not something to read much into on its own.
 * Anchoring the slope on that much larger sample put the answer at **1.11**,
 * and a second 19,840-game run there returned **54.23%**: 0.21pp high against
 * a standard error of 0.36. That is where it sits.
 *
 * So the per-channel gaps need scaling by about a tenth, and no more. Worth
 * being clear that this could have gone very differently: the raw splits are
 * confounded by score state — the home team leads more often, so it runs more
 * and throws shorter — which is why the EPA column in the measurement script
 * points the *wrong* way while every other column points the right one. That
 * confound suppresses the measured gaps, so a scale of two or three would not
 * have been surprising. The mechanism is doing essentially all of the work.
 *
 * ## The one target it misses
 *
 * Two numbers describe a home-field advantage and they do not agree here.
 * Fitting the **win rate** gives 1.11; fitting the league's **+1.57 mean
 * margin** would need 1.32, and that would put the win rate at 54.8% — two
 * standard errors *above* the league, trading a miss inside the noise for one
 * outside it.
 *
 * So this fits the win rate, and the margin comes out around +1.3 against a
 * real +1.57. Stated rather than hidden: the engine's home teams win as often
 * as the league's, by about a quarter-point less. Efficiency shifts convert
 * into wins more readily than into points, and closing that would mean
 * modelling the part of the advantage that isn't efficiency at all — field
 * position off returns, and fourth-down nerve in front of a crowd.
 *
 * ## What it does not touch
 *
 * The right-hand column above is the other half of the result: points per
 * team-game is 20.84, 20.82, 20.84 across scales that move the home win rate
 * by twelve points. The symmetric split means the league's scoring is
 * untouched, so nothing §22 measures moves.
 *
 * And none of it applies without rosters. `simulateGame(seed)` with no team
 * codes — which is exactly how §22/§23 validate — has two anonymous sides and
 * no venue, so it is byte-identical to the pre-OQ-10 engine.
 */

/** The measured home-minus-away gap in each channel, halved. */
export const HOME_FIELD = {
  /** M09 COMPLETE, logit. */
  complete: 0.024_298_2,
  /** M04 SACK, logit. Negative: the home offense is sacked less. */
  sack: -0.023_346_5,
  /** M09 INTERCEPTION, logit. Negative: the home offense throws fewer. */
  interception: -0.014_348_5,
  /** M20 MADE, logit. */
  fgMade: 0.032_474_5,
  /** Yards per carry. */
  rushYards: 0.030_28,
  /**
   * Multiplier on the pre-snap (dead-ball) foul hazard: the home offense is
   * multiplied by this, the away offense divided by it. Geometric so the two
   * remain each other's inverse and the average is untouched.
   *
   * Measured on fouls charged to the team *with the ball*, but applied to the
   * whole dead-ball hazard, which then splits between offense and defense as
   * it always did. That slightly over-applies it — a road defense is not
   * obviously noisier than a home one — but the whole channel is about 0.07
   * flags a game, and separating the two would mean reordering the RNG draws
   * for a rounding error.
   */
  presnapPenalty: 0.972_378_2,
} as const;

/**
 * Fitted at 1.11 against the league's home win rate — see the header.
 *
 * Sweeping it is how the size of the effect was checked rather than assumed,
 * and the sweep said the measured gaps need no scaling. Set it to 0 and the
 * engine is exactly what it was before OQ-10.
 *
 * The environment override exists for `analysis/32_fit_home_field.ts` and
 * nothing else: sweeping a constant means changing it thousands of times, and
 * the alternative is mutable state inside a deterministic engine. Production
 * never sets it, and it is read once at load, so a run is as deterministic as
 * it ever was.
 */
export const HOME_FIELD_SCALE = envScale() ?? 1.11;

function envScale(): number | null {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env?.HOME_FIELD_SCALE;
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Which side of the advantage a team is on: +1 at home, -1 away, 0 neutral. */
export type HomeEdge = 1 | -1 | 0;

/**
 * The home-field shift for one channel, for the team currently on offense.
 *
 * `edge` is +1 when the offense is the home team, -1 when it is the visitor,
 * and 0 at a neutral site (the Super Bowl) or whenever the caller has no
 * meaningful home team to speak of.
 */
export function homeShift(edge: HomeEdge, channel: keyof typeof HOME_FIELD): number {
  if (edge === 0) return 0;
  return edge * HOME_FIELD_SCALE * HOME_FIELD[channel];
}

/**
 * The pre-snap foul multiplier for the offense.
 *
 * Multiplicative rather than additive, because it scales a hazard rate.
 * `HOME_FIELD_SCALE` enters as an exponent so that scaling it stays
 * symmetric — home and away remain exact reciprocals at any scale.
 */
export function homePenaltyScale(edge: HomeEdge): number {
  if (edge === 0) return 1;
  return Math.pow(HOME_FIELD.presnapPenalty, edge * HOME_FIELD_SCALE);
}
