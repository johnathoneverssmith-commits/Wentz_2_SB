import { describe, expect, it } from "vitest";

import type { Coach } from "@/domain";

import { COACH_BANDS, coachToEngine, coachToUi, engineStaffFor } from "./coachScale.ts";

/**
 * Coaches cross between the engine's scale and the game's in one place, and
 * a franchise's own staff is what its games are coached by.
 */
describe("coach scales", () => {
  it("maps each band's ends onto each other and round-trips in between", () => {
    for (const [key, b] of Object.entries(COACH_BANDS)) {
      const k = key as keyof typeof COACH_BANDS;
      expect(coachToUi(k, b.engine[0]), `${k} low`).toBe(b.ui[0]);
      expect(coachToUi(k, b.engine[1]), `${k} high`).toBe(b.ui[1]);
      const mid = (b.engine[0] + b.engine[1]) / 2;
      expect(coachToEngine(k, coachToUi(k, mid)), `${k} round trip`).toBeCloseTo(mid, 1);
    }
  });

  it("puts the engine-backed and offline markets on the same scale", () => {
    // an authored-average head coach (engine ~55) reads mid-scale, not 55
    expect(coachToUi("gameManagement", 55)).toBe(75);
  });
});

describe("a franchise's staff", () => {
  const coach = (role: Coach["role"], extra: Partial<Coach>): Coach =>
    ({ id: role, name: `${role} guy`, role, team: "GB", contract: null, ...extra }) as Coach;

  it("is the coaches the team employs, in engine units", () => {
    const s = {
      coaches: {
        HC: coach("HC", { gameManagement: 95, discipline: 55, aggressiveness: 95 }),
        OC: coach("OC", { playCallIq: 95, scheme: "spread", tendencyPassRate: 68 }),
        DC: coach("DC", { playCallIq: 55, scheme: "cover_2", tendencyBlitzRate: 18 }),
      },
    };
    const st = engineStaffFor(s as never, "GB");
    expect(st.headCoach.gameManagement).toBeCloseTo(66, 5);
    expect(st.headCoach.discipline).toBeCloseTo(44, 5);
    expect(st.oc.rating).toBeCloseTo(66, 5);
    expect(st.oc.scheme).toBe("spread");
    expect(st.dc.rating).toBeCloseTo(46, 5);
  });

  it("plays a vacancy as the engine's league-average coach — exactly zero effect", () => {
    const st = engineStaffFor({ coaches: {} } as never, "GB");
    expect(st.headCoach).toMatchObject({ gameManagement: 50, discipline: 50, aggression: 0 });
    expect(st.oc).toMatchObject({ rating: 50, passBias: 0 });
    expect(st.dc).toMatchObject({ rating: 50, blitzBias: 0 });
  });
});
