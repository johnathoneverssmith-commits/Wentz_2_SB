import { describe, expect, it } from "vitest";

import {
  applyCoachToDelta,
  developmentMultiplier,
  NEUTRAL_COACH_OVERALL,
  recoveryMultiplier,
  regressionMultiplier,
} from "@/state/coachEffects.ts";
import { coachRoleForPosition } from "@/domain";

/**
 * Change 3 — what the nine development coaches are worth.
 *
 * 72 is neutral and every point either side moves the relevant rate by one
 * percent, applied in opposite directions to development and regression. The
 * symmetry is the substance: the same distance from neutral has to be worth
 * the same amount whichever way it runs, or a good hire and a bad one are not
 * the same decision reversed.
 */
describe("coach effect scale", () => {
  it("changes nothing at 72", () => {
    expect(developmentMultiplier(72)).toBe(1);
    expect(regressionMultiplier(72)).toBe(1);
    expect(recoveryMultiplier(72)).toBe(1);
    expect(NEUTRAL_COACH_OVERALL).toBe(72);
  });

  it("moves one percent per point", () => {
    expect(developmentMultiplier(82)).toBeCloseTo(1.1, 10);
    expect(developmentMultiplier(62)).toBeCloseTo(0.9, 10);
    expect(regressionMultiplier(82)).toBeCloseTo(0.9, 10);
    expect(regressionMultiplier(62)).toBeCloseTo(1.1, 10);
  });

  it("is symmetric — a bad hire costs what a good one gains", () => {
    for (const d of [5, 12, 27]) {
      const good = developmentMultiplier(72 + d) - 1;
      const bad = 1 - developmentMultiplier(72 - d);
      expect(good).toBeCloseTo(bad, 10);
    }
  });

  it("applies development and regression in opposite directions", () => {
    const good = 90;
    expect(developmentMultiplier(good)).toBeGreaterThan(1);
    expect(regressionMultiplier(good)).toBeLessThan(1);
    const bad = 45;
    expect(developmentMultiplier(bad)).toBeLessThan(1);
    expect(regressionMultiplier(bad)).toBeGreaterThan(1);
  });

  it("shortens recovery for a good training room and lengthens it for a poor one", () => {
    expect(recoveryMultiplier(92)).toBeCloseTo(0.8, 10);
    expect(recoveryMultiplier(52)).toBeCloseTo(1.2, 10);
    // never negative, however bad the coach
    expect(recoveryMultiplier(35)).toBeGreaterThan(0);
    expect(recoveryMultiplier(99)).toBeGreaterThan(0);
  });

  it("never turns a gain into a loss, or a loss into a gain", () => {
    for (const ovr of [35, 50, 72, 85, 99]) {
      const mods = {
        development: developmentMultiplier(ovr),
        regression: regressionMultiplier(ovr),
      };
      expect(applyCoachToDelta(3, mods)).toBeGreaterThan(0);
      expect(applyCoachToDelta(-3, mods)).toBeLessThan(0);
    }
  });

  it("never rounds a real change away to nothing", () => {
    // a +1 under a poor coach still has to be an improvement, not a zero
    const poor = { development: developmentMultiplier(40), regression: regressionMultiplier(40) };
    expect(applyCoachToDelta(1, poor)).toBe(1);
    const great = { development: developmentMultiplier(99), regression: regressionMultiplier(99) };
    expect(applyCoachToDelta(-1, great)).toBe(-1);
  });

  it("leaves an unchanged player unchanged", () => {
    const mods = { development: developmentMultiplier(99), regression: regressionMultiplier(99) };
    expect(applyCoachToDelta(0, mods)).toBe(0);
  });
});

describe("who coaches whom", () => {
  it("maps every position group to exactly one coach", () => {
    expect(coachRoleForPosition("QB")).toBe("QB");
    expect(coachRoleForPosition("RB")).toBe("RB");
    expect(coachRoleForPosition("C")).toBe("OL");
    expect(coachRoleForPosition("OG")).toBe("OL");
    expect(coachRoleForPosition("OT")).toBe("OL");
    expect(coachRoleForPosition("WR")).toBe("WR");
    expect(coachRoleForPosition("TE")).toBe("WR");
    expect(coachRoleForPosition("DT")).toBe("DL");
    expect(coachRoleForPosition("EDGE")).toBe("DL");
    expect(coachRoleForPosition("ILB")).toBe("LB");
    expect(coachRoleForPosition("OLB")).toBe("LB");
    expect(coachRoleForPosition("CB")).toBe("DB");
    expect(coachRoleForPosition("S")).toBe("DB");
    expect(coachRoleForPosition("K")).toBe("ST");
    expect(coachRoleForPosition("P")).toBe("ST");
  });

  it("has nobody coaching a position that does not exist here", () => {
    // long snappers are not in this league and must not map to a staff job
    expect(coachRoleForPosition("LS")).toBeNull();
  });
});
