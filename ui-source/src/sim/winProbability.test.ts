import { describe, expect, it } from "vitest";

import { winChance, winProbability } from "./win-probability.ts";

/**
 * The measured curve, checked against the measurement.
 *
 * These are empirical home-team win rates from
 * `analysis/30_win_probability.ts --talent 1` (15,872 engine games, every
 * ordered pair of the 32 rosters and their weakened copies, the listed team
 * hosting), bucketed by rating gap — not the fit's own output. Re-measured
 * after synergy and the team-strength index made rosters far more decisive
 * than the first curve (0.147 a point) knew.
 *
 * Tolerance is 3.5 points: the logistic is a slightly imperfect shape for
 * the data around ±2 (about two points off on ~2,300 games a bucket).
 */
const MEASURED: ReadonlyArray<readonly [gap: number, actualPct: number, games: number]> = [
  [-10, 1.0, 394],
  [-8, 2.1, 762],
  [-6, 5.6, 1233],
  [-4, 15.4, 1765],
  [-2, 32.6, 2280],
  [0, 54.6, 2660],
  [2, 72.3, 2308],
  [4, 86.8, 1770],
  [6, 95.1, 1235],
  [8, 99.1, 772],
  [10, 99.8, 409],
];

/** The same measurement at Amplified talent (1.5), the default for new leagues. */
const MEASURED_AMPLIFIED: ReadonlyArray<readonly [gap: number, actualPct: number]> = [
  [-4, 8.7],
  [-2, 24.0],
  [0, 52.6],
  [2, 79.3],
  [4, 93.8],
];

describe("win probability", () => {
  it("matches what the engine actually did, at every gap it was measured over", () => {
    for (const [gap, actual] of MEASURED) {
      expect(Math.abs(winProbability(75 + gap, 75, "home") - actual)).toBeLessThan(3.5);
    }
  });

  it("follows the talent-impact setting: amplified rosters decide more games", () => {
    for (const [gap, actual] of MEASURED_AMPLIFIED) {
      expect(Math.abs(winProbability(75 + gap, 75, "home", 1.5) - actual)).toBeLessThan(3.5);
    }
    expect(winProbability(78, 75, "neutral", 2)).toBeGreaterThan(winProbability(78, 75, "neutral", 1));
  });

  it("gives an even matchup an even chance — the engine has no home field", () => {
    // 49.7% measured over 7,980 games; the old formula claimed 54%
    expect(winProbability(80, 80)).toBe(50);
    expect(winProbability(68, 68)).toBe(50);
  });

  it("is symmetric: one team's chance is the other's, inverted", () => {
    for (let gap = -12; gap <= 12; gap += 3) {
      expect(winProbability(75 + gap, 75) + winProbability(75, 75 + gap)).toBe(100);
    }
  });

  it("rises with the gap and never leaves 1–99", () => {
    let prev = 0;
    for (let gap = -40; gap <= 40; gap += 1) {
      const p = winProbability(75 + gap, 75);
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(99);
      prev = p;
    }
  });

  it("stops extrapolating past the gaps that were measured", () => {
    // beyond ±12 the logistic keeps climbing and the data doesn't, so a
    // 25-point mismatch reads the same as an 18-point one rather than 99%
    expect(winProbability(75 + 18, 75)).toBe(winProbability(75 + 40, 75));
    expect(winProbability(75 - 18, 75)).toBe(winProbability(75 - 40, 75));
  });

  it("says nothing useful rather than crashing on a number that isn't one", () => {
    expect(winProbability(NaN, 75)).toBe(50);
    expect(winProbability(75, undefined as unknown as number)).toBe(50);
  });

  it("beats the formula it replaced against the same data", () => {
    const old = (gap: number) => Math.min(90, Math.max(10, Math.round((0.5 + gap * 0.02) * 100)));
    let mine = 0;
    let theirs = 0;
    let n = 0;
    for (const [gap, actual, games] of MEASURED) {
      mine += games * Math.abs(winProbability(75 + gap, 75, "home") - actual);
      theirs += games * Math.abs(old(gap) - actual);
      n += games;
    }
    expect(mine / n).toBeLessThan(theirs / n / 4);
  });

  it("hands the same answer back as a probability", () => {
    expect(winChance(85, 75)).toBeCloseTo(winProbability(85, 75) / 100, 5);
  });
});

/**
 * The venue.
 *
 * The engine gives the home team a real advantage now (OQ-10), fitted so it
 * wins 54% of games against an even opponent — the league's own rate over
 * 2018-2025. These check that the display agrees with the simulator, and that
 * asking about a matchup from both ends gives two answers that add up.
 */
describe("home field", () => {
  it("makes an even matchup at home about a 54% proposition", () => {
    expect(winProbability(76, 76, "home")).toBe(54);
    expect(winProbability(76, 76, "away")).toBe(46);
  });

  it("is worth nothing at a neutral site — which the Super Bowl is", () => {
    expect(winProbability(76, 76, "neutral")).toBe(50);
    // the same two-point favourite, three ways round
    expect(winProbability(78, 76, "neutral")).toBeLessThan(winProbability(78, 76, "home"));
    expect(winProbability(78, 76, "neutral")).toBeGreaterThan(winProbability(78, 76, "away"));
  });

  it("gives two views of one game that add to 100", () => {
    for (let gap = -10; gap <= 10; gap += 5) {
      expect(
        winProbability(75 + gap, 75, "home") + winProbability(75, 75 + gap, "away"),
      ).toBe(100);
    }
  });

  it("is worth about a third of a rating point", () => {
    // 0.1611 of log-odds against a slope of 0.478 a point: ratings decide
    // games so strongly now that a one-point underdog is an underdog even at
    // home, and home field only tips a dead-even game.
    expect(winProbability(75, 76, "home")).toBeLessThan(50);
    expect(winProbability(75, 75, "home")).toBeGreaterThan(50);
  });
});
