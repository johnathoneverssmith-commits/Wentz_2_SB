import { DEFAULT_PLAN, type GamePlan } from "./gameplan.js";
import { simulateGame } from "./sim.js";

type Options = NonNullable<Parameters<typeof simulateGame>[3]>;

export interface PlanPreview {
  /** win chance, 0-100, with the standard plan */
  standard: number;
  /** win chance, 0-100, with the plan being tried */
  withPlan: number;
  /** average points of margin the plan adds (negative: costs) */
  marginDelta: number;
  /** the margin estimate's uncertainty, two standard errors, in points */
  plusMinus: number;
  /** the plan's effect is inside the noise of this many games */
  tooClose: boolean;
  /** games played each way */
  games: number;
}

/** A game's final margin is about this spread around its expectation (NFL ~13.5; the engine's ~13). */
const MARGIN_SD = 13.2;
const phi = (z: number): number => {
  // Abramowitz-Stegun 7.1.26, plenty for a percentage
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

/**
 * What a game plan is worth against one opponent, measured rather than
 * guessed: the same game played `games` times each way, on the same seeds
 * and with everything else identical, once with the standard plan and once
 * with the plan being tried.
 *
 * Read off the margin, not the win count. Plans move a game by a point or
 * two, and a few hundred wins and losses cannot see that through the noise
 * (the paired win-rate difference has a standard error near four points at
 * 200 games); the paired margin can, and a margin turns into a win chance
 * through the spread of final scores. A tie counts half in the base rate.
 *
 * The preseason's lab: a GM tries a blitz rate or a run lean against a real
 * opponent and sees the chance move, or not, before it counts.
 */
export function previewPlan(
  seedBase: number,
  home: string,
  away: string,
  options: Options,
  side: "home" | "away",
  plan: GamePlan,
  games = 160,
): PlanPreview {
  let wins = 0;
  let margin = 0;
  let delta = 0;
  let delta2 = 0;
  const mine = (s: readonly number[]): number => (side === "home" ? s[0]! - s[1]! : s[1]! - s[0]!);
  const key = side === "home" ? "homePlan" : "awayPlan";
  for (let i = 0; i < games; i++) {
    const seed = (seedBase + i * 7919) >>> 0;
    const a = mine(simulateGame(seed, home, away, { ...options, [key]: { ...DEFAULT_PLAN } }).score);
    const b = mine(simulateGame(seed, home, away, { ...options, [key]: plan }).score);
    wins += a > 0 ? 1 : a === 0 ? 0.5 : 0;
    margin += a;
    delta += b - a;
    delta2 += (b - a) * (b - a);
  }
  const base = wins / games;
  const d = delta / games;
  // where the standard plan sits on the margin curve, then moved by the plan's points
  const z = Math.max(-3, Math.min(3, (margin / games) / MARGIN_SD));
  const shifted = phi(z + d / MARGIN_SD) - phi(z);
  const pct = (x: number) => Math.max(1, Math.min(99, Math.round(x * 100)));
  // a plan changes the random stream from its first decision on, so pairs
  // decorrelate within a drive or two: say how sure the number is
  const sd = Math.sqrt(Math.max(0, delta2 / games - d * d));
  const plusMinus = (2 * sd) / Math.sqrt(games);
  return {
    standard: pct(base),
    withPlan: pct(base + shifted),
    marginDelta: Math.round(d * 10) / 10,
    plusMinus: Math.round(plusMinus * 10) / 10,
    tooClose: Math.abs(d) < plusMinus,
    games,
  };
}
