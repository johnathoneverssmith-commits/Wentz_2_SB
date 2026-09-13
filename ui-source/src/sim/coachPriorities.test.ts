import { describe, expect, it } from "vitest";

import type { Coach } from "@/domain";

import { coachPriorities } from "./priorities.ts";

/**
 * The asking price raised `(iq - 55) / 10` to the 1.6 — and a negative base
 * to a fractional power is NaN in JavaScript. The engine's real staffs
 * include plenty of coordinators under 55, so Baltimore's defensive
 * coordinator was on the staff screen asking for "$NaNM/yr".
 */
function coach(over: Partial<Coach>): Coach {
  return { id: "c_1", name: "A. Coach", role: "DC", team: null, contract: null, ...over } as Coach;
}

describe("coachPriorities", () => {
  it("quotes a real number for a coordinator rated below the league mean", () => {
    const p = coachPriorities(coach({ playCallIq: 52 }));
    expect(Number.isFinite(p.expectation.baseSalary)).toBe(true);
    expect(p.expectation.baseSalary).toBeGreaterThan(0);
    expect(Number.isFinite(p.expectation.guaranteed)).toBe(true);
    expect(Number.isFinite(p.expectation.signingBonus)).toBe(true);
  });

  it("quotes a real number across the whole rating range", () => {
    for (let iq = 1; iq <= 99; iq++) {
      const p = coachPriorities(coach({ id: `c_${iq}`, playCallIq: iq }));
      expect(Number.isFinite(p.expectation.baseSalary), `iq ${iq}`).toBe(true);
    }
  });

  it("still pays a better coach more", () => {
    const weak = coachPriorities(coach({ id: "c_a", playCallIq: 50 })).expectation.baseSalary;
    const strong = coachPriorities(coach({ id: "c_a", playCallIq: 90 })).expectation.baseSalary;
    expect(strong).toBeGreaterThan(weak);
  });

  it("falls back to a head coach's game management when there's no play-call IQ", () => {
    const p = coachPriorities(coach({ role: "HC", playCallIq: undefined, gameManagement: 40 }));
    expect(Number.isFinite(p.expectation.baseSalary)).toBe(true);
  });
});
