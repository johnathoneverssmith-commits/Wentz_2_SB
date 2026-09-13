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

/**
 * A draft class has to be worse than the league it enters, or the league
 * inflates every year and a veteran roster loses value for free. The old
 * curve ran `trueOverall` straight off the college grade and produced a
 * median prospect of 77 against a league median of ~70.
 */
describe("draft class strength", () => {
  const klass = new MockSimulationService().generateDraftClass(5, 2027);
  const trues = klass.map((p) => p.trueOverall).sort((a, b) => b - a);

  it("puts the median prospect below a median NFL roster player", () => {
    const median = trues[Math.floor(trues.length / 2)]!;
    expect(median).toBeGreaterThan(55); // still a draftable pro
    expect(median).toBeLessThan(68); // but below the ~70 league median
  });

  it("decays sharply from the top of the board to the end of day three", () => {
    const top10 = trues.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const last10 = trues.slice(-10).reduce((a, b) => a + b, 0) / 10;
    expect(top10 - last10).toBeGreaterThan(20);
  });

  it("never hands out an All-Pro rookie", () => {
    expect(trues[0]).toBeLessThanOrEqual(90);
  });

  it("orders the board by talent, so an earlier pick is better on average", () => {
    const firstRound = klass.slice(0, 32).reduce((a, p) => a + p.trueOverall, 0) / 32;
    const lastRound = klass.slice(-32).reduce((a, p) => a + p.trueOverall, 0) / 32;
    expect(firstRound).toBeGreaterThan(lastRound + 12);
  });
});
