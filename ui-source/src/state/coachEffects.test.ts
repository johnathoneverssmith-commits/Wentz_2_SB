import { describe, expect, it } from "vitest";

import type { Coach } from "@/domain";

import { coachPriorities } from "../sim/priorities.ts";
import {
  applyCoachToDelta,
  developmentMultiplier,
  headCoachRating,
  programSwing,
  regressionMultiplier,
  roundBy,
  COACH_TUNING,
  coachModifiersFor,
} from "./coachEffects.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { runTrainingCamp } from "./trainingCamp.ts";
import { DEVELOPMENT_ROLES } from "@/domain";

describe("roundBy", () => {
  const rolls = Array.from({ length: 1000 }, (_, i) => i / 1000);
  it("keeps the expected value, in both directions", () => {
    for (const x of [0.3, 1.07, 2.5, -0.55, -1.8, -4.2]) {
      const mean = rolls.reduce((a, r) => a + roundBy(x, r), 0) / rolls.length;
      expect(mean).toBeCloseTo(x, 2);
    }
  });
  it("never moves a whole number and never changes a sign", () => {
    for (const r of rolls) {
      expect(roundBy(3, r)).toBe(3);
      expect(roundBy(-2, r)).toBe(-2);
      expect(roundBy(0.9, r)).toBeGreaterThanOrEqual(0);
      expect(roundBy(-0.9, r)).toBeLessThanOrEqual(0);
    }
  });
  it("lets a small effect through on average where plain rounding would lose it", () => {
    const mods = { development: 1.07, regression: 0.93 };
    expect(applyCoachToDelta(2, mods)).toBe(2); // the old rule: a 7% edge on +2 is nothing
    const mean = rolls.reduce((a, r) => a + applyCoachToDelta(2, mods, r), 0) / rolls.length;
    expect(mean).toBeCloseTo(2.14, 2);
  });
});

describe("the coach curve", () => {
  it("is linear within the inner band and flatter beyond", () => {
    expect(developmentMultiplier(72 + 10)).toBeCloseTo(1 + 10 * COACH_TUNING.INNER_SWING_PER_OVR, 10);
    const inner = developmentMultiplier(84) - developmentMultiplier(72);
    const outer = developmentMultiplier(96) - developmentMultiplier(84);
    expect(outer).toBeLessThan(inner);
    expect(outer).toBeGreaterThan(0);
  });
  it("stays symmetric: a bad hire costs what a good one gains", () => {
    for (const d of [5, 12, 20, 30]) {
      expect(developmentMultiplier(72 + d) - 1).toBeCloseTo(1 - developmentMultiplier(72 - d), 10);
      expect(1 - regressionMultiplier(72 + d)).toBeCloseTo(regressionMultiplier(72 - d) - 1, 10);
    }
  });
});

describe("the head coach's program", () => {
  const hc = (gameManagement: number, discipline: number) => ({ gameManagement, discipline }) as Coach;
  it("is zero for a neutral or missing head coach", () => {
    expect(programSwing(headCoachRating(undefined))).toBe(0);
    expect(programSwing(headCoachRating(hc(72, 72)))).toBe(0);
  });
  it("moves with the average of game management and discipline, both ways", () => {
    expect(programSwing(headCoachRating(hc(90, 80)))).toBeGreaterThan(0);
    expect(programSwing(headCoachRating(hc(60, 50)))).toBeLessThan(0);
  });
});

describe("what a coach asks", () => {
  const dev = (overall: number, role = "OL") => ({ id: "c_x", name: "A", role, team: null, contract: null, overall }) as Coach;
  it("rises with a position coach's rating (it used to ignore it)", () => {
    const pay = (o: number) => coachPriorities(dev(o)).expectation.baseSalary;
    expect(pay(95)).toBeGreaterThan(pay(72));
    expect(pay(72)).toBeGreaterThan(pay(45) - 1e-9);
    expect(pay(95)).toBeGreaterThan(pay(45) * 1.5);
  });
  it("pays the special-teams coach less than a line coach of the same rating", () => {
    expect(coachPriorities(dev(90, "ST")).expectation.baseSalary).toBeLessThan(coachPriorities(dev(90, "OL")).expectation.baseSalary);
  });
});

describe("a whole camp, paired", () => {
  const base = createLeague(9, { ...DEFAULT_CONFIG, fantasyDraft: false });
  type L = typeof base;
  const staffed = (dev: number, hc: number): L => {
    const s = JSON.parse(JSON.stringify(base)) as L;
    const codes = Object.keys(s.teams);
    const byRole: Record<string, L["coaches"][string][]> = {};
    for (const c of Object.values(s.coaches)) if ((DEVELOPMENT_ROLES as readonly string[]).includes(c.role)) (byRole[c.role] ??= []).push(c);
    for (const list of Object.values(byRole)) list.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((c, i) => { if (i < codes.length) c.team = codes[i]!; c.overall = dev; });
    for (const c of Object.values(s.coaches)) if (c.role === "HC" && c.team) { c.gameManagement = hc; c.discipline = hc; }
    return s;
  };
  const camp = (s: L): Record<string, number> => {
    s.trainingCamp = null;
    const before = Object.fromEntries(Object.values(s.players).map((p) => [p.id, p.overall]));
    for (const t of Object.keys(s.teams)) runTrainingCamp(s, t, { offensiveFocus: null, defensiveFocus: null, submitted: true });
    return Object.fromEntries(Object.values(s.players).filter((p) => p.nfl_team !== "FA").map((p) => [p.id, p.overall - before[p.id]!]));
  };
  const total = (d: Record<string, number>): number => Object.values(d).reduce((a, b) => a + b, 0);

  it("neutral staffs change nothing: the same camp as a team with no coaches at all", () => {
    const vacant = staffed(72, 72);
    for (const c of Object.values(vacant.coaches)) if ((DEVELOPMENT_ROLES as readonly string[]).includes(c.role)) c.team = null;
    expect(camp(staffed(72, 72))).toEqual(camp(vacant));
  });
  it("a better position staff grows the roster more, a worse one less, on the same draws", () => {
    const lo = total(camp(staffed(40, 72)));
    const mid = total(camp(staffed(72, 72)));
    const hi = total(camp(staffed(95, 72)));
    expect(hi).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(lo);
  });
  it("the head coach moves every group, both ways, and the effect is smaller than the whole position staff's", () => {
    const mid = total(camp(staffed(72, 72)));
    const goodHc = total(camp(staffed(72, 90)));
    const badHc = total(camp(staffed(72, 55)));
    const goodPos = total(camp(staffed(95, 72)));
    expect(goodHc).toBeGreaterThan(mid);
    expect(badHc).toBeLessThan(mid);
    expect(goodHc - mid).toBeLessThan(goodPos - mid);
  });
  it("no staff, however good, turns a decline into a gain or keeps a loss below the stack limit", () => {
    const s = staffed(99, 99);
    const mods = coachModifiersFor(s, Object.keys(s.teams)[0]!, "QB");
    expect(mods.regression).toBeGreaterThanOrEqual(COACH_TUNING.MIN_REGRESSION);
    expect(mods.development).toBeLessThanOrEqual(COACH_TUNING.MAX_DEVELOPMENT);
    const d = camp(s);
    const p = Object.values(s.players).find((x) => x.nfl_team !== "FA" && x.age >= x.decline_age_threshold + 2)!;
    expect(d[p.id]!).toBeLessThanOrEqual(0);
  });
  it("is the same camp twice (determinism)", () => {
    expect(camp(staffed(88, 80))).toEqual(camp(staffed(88, 80)));
  });
});
