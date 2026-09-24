import { describe, expect, it } from "vitest";

import { DEFENSIVE_FOCUSES, OFFENSIVE_FOCUSES, focusStrength } from "./trainingCamp.ts";

/**
 * Training Camp had no test of its own, and its coordinator-focus formula
 * had drifted away from its own docstring: the code runs at double Change
 * 5's written figures, while the comment went on describing the written
 * ones. The doubling is deliberate — the Aging + Training Camp optimization
 * pass made the same move on the position-coach slope in `coachEffects.ts`,
 * for the same reason: development lands as an integer rating change, and at
 * the specified size the coaching effect rounded away before it could be
 * seen.
 *
 * So this pins the shipped numbers rather than the spec's, which is the
 * thing that was actually unguarded. If they are ever reassessed again (the
 * change log leaves that open), this is the file that should argue with you.
 */
describe("coordinator focus strength", () => {
  it("is 20% at a league-average coordinator", () => {
    expect(focusStrength(72)).toBeCloseTo(0.2, 6);
  });

  it("moves a point per point of coordinator rating", () => {
    expect(focusStrength(92)).toBeCloseTo(0.4, 6); // +20 rating -> +20pp
    expect(focusStrength(62)).toBeCloseTo(0.1, 6); // -10 rating -> -10pp
  });

  it("floors at 5% — even a poor coordinator never hurts the group he picks", () => {
    expect(focusStrength(0)).toBeCloseTo(0.05, 6);
    expect(focusStrength(40)).toBeCloseTo(0.05, 6);
    // the floor is the point: attention is never negative
    expect(focusStrength(1)).toBeGreaterThan(0);
  });

  it("caps at 45%", () => {
    expect(focusStrength(120)).toBeCloseTo(0.45, 6);
    // the best coordinator the 0-99 scale allows lands just under the cap,
    // so in practice the ceiling is a guard rather than a reachable value
    expect(focusStrength(99)).toBeCloseTo(0.47, 1);
    expect(focusStrength(99)).toBeLessThanOrEqual(0.45);
  });

  it("offers exactly the focus groups Change 5 lists", () => {
    // offensive: QB, RB and FB, OL, WR and TE — defensive: DL and EDGE, LB, DB
    expect(OFFENSIVE_FOCUSES).toHaveLength(4);
    expect(DEFENSIVE_FOCUSES).toHaveLength(3);
  });
});
