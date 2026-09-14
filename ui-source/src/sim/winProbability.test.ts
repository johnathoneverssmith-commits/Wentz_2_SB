import { describe, expect, it } from "vitest";

import { winChance, winProbability } from "./win-probability.ts";

/**
 * The measured curve, checked against the measurement.
 *
 * These numbers are not the fit's own output — they are the empirical
 * win rates from `analysis/30_win_probability.ts`, 47,616 engine games
 * bucketed by rating gap. The fit has to land on them, because agreeing with
 * itself would test nothing.
 *
 * They were measured before the engine had a home-field advantage, which
 * makes them exactly the right thing to check the **neutral** curve against:
 * every game in that run was, in effect, at a neutral site. Home field enters
 * as an intercept and leaves the slope alone, so `B` is still what those
 * games say it is — and the venue term is checked separately below, against
 * the league rate the engine is fitted to.
 *
 * Tolerance is 2.5 points, which is roughly two standard errors on the
 * thinnest bucket (n≈320) and far more than that on the thick ones. The two
 * widest gaps are excluded and tested separately: the logistic runs slightly
 * ahead of the data there, which is why the curve clamps rather than
 * extrapolates.
 */
const MEASURED: ReadonlyArray<readonly [gap: number, actualPct: number, games: number]> = [
  [-10, 17.1, 1182],
  [-8, 23.0, 2286],
  [-6, 29.4, 3699],
  [-4, 36.4, 5295],
  [-2, 42.8, 6840],
  [0, 50.0, 7980],
  [2, 55.6, 6924],
  [4, 62.9, 5310],
  [6, 70.4, 3705],
  [8, 77.9, 2316],
  [10, 81.4, 1227],
];

describe("win probability", () => {
  it("matches what the engine actually did, at every gap it was measured over", () => {
    for (const [gap, actual] of MEASURED) {
      expect(Math.abs(winProbability(75 + gap, 75) - actual)).toBeLessThan(2.5);
    }
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
    // beyond ±14 the logistic keeps climbing and the data doesn't, so a
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
      mine += games * Math.abs(winProbability(75 + gap, 75) - actual);
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
    // the same eight-point favourite, three ways round
    expect(winProbability(84, 76, "neutral")).toBeLessThan(winProbability(84, 76, "home"));
    expect(winProbability(84, 76, "neutral")).toBeGreaterThan(winProbability(84, 76, "away"));
  });

  it("gives two views of one game that add to 100", () => {
    for (let gap = -10; gap <= 10; gap += 5) {
      expect(
        winProbability(75 + gap, 75, "home") + winProbability(75, 75 + gap, "away"),
      ).toBe(100);
    }
  });

  it("is worth about one rating point, and not two", () => {
    // 0.1611 of log-odds against a slope of 0.1467 a point: the venue buys
    // you 1.1 points of roster. A one-point underdog at home is a coin flip;
    // a two-point underdog is still an underdog.
    expect(winProbability(75, 76, "home")).toBe(50);
    expect(winProbability(75, 77, "home")).toBeLessThan(50);
    expect(winProbability(76, 75, "away")).toBe(50);
  });
});
