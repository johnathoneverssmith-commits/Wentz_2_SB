import { describe, expect, it } from "vitest";

import { MockSimulationService } from "./MockSimulationService.ts";
import { POSITIONS } from "@/domain";

/**
 * generateDraftClass (real-data grounding): position mix should vary by
 * round the way actual NFL drafts do (kickers/punters essentially never go
 * in round 1, CB is drafted heavily in every round), and draft age should
 * vary meaningfully by position — both sourced from the 2018-2026
 * PFR draft-history dataset (draft-history.ts), not flat/round-agnostic.
 */

const sim = new MockSimulationService();

function classesFor(seeds: number[], year = 2026) {
  return seeds.map((s) => sim.generateDraftClass(s, year));
}

describe("generateDraftClass", () => {
  it("produces exactly 224 prospects with valid positions", () => {
    const cls = sim.generateDraftClass(1, 2026);
    expect(cls).toHaveLength(224);
    for (const p of cls) {
      expect(POSITIONS).toContain(p.position);
    }
  });

  it("almost never puts a kicker or punter in round 1, unlike round 6-7", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const classes = classesFor(seeds);
    let round1Specialists = 0;
    let lateRoundSpecialists = 0;
    for (const cls of classes) {
      for (let i = 0; i < cls.length; i++) {
        const slotRound = Math.ceil((i + 1) / 32);
        const isSpecialist = cls[i]!.position === "K" || cls[i]!.position === "P";
        if (slotRound === 1 && isSpecialist) round1Specialists++;
        if (slotRound >= 6 && isSpecialist) lateRoundSpecialists++;
      }
    }
    expect(round1Specialists).toBe(0);
    expect(lateRoundSpecialists).toBeGreaterThan(0);
  });

  it("draft-day age differs meaningfully by position (punters older than backs, on average)", () => {
    const seeds = Array.from({ length: 60 }, (_, i) => i + 1);
    const classes = classesFor(seeds);
    const ages: Record<string, number[]> = {};
    for (const cls of classes) {
      for (const p of cls) {
        (ages[p.position] ??= []).push(p.age);
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // P/QB skew older in the real data; RB/WR skew younger
    expect(mean(ages.P!)).toBeGreaterThan(mean(ages.RB!));
    expect(mean(ages.QB!)).toBeGreaterThan(mean(ages.WR!));
  });

  it("is deterministic for a given seed/year", () => {
    const a = sim.generateDraftClass(7, 2026);
    const b = sim.generateDraftClass(7, 2026);
    expect(a).toEqual(b);
  });
});
