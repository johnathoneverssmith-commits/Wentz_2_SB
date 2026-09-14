import { describe, expect, it } from "vitest";

import { REAL_STARTER_RATE_BY_ROUND } from "./draft-outcomes.ts";
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
/**
 * The mapping from career Approximate Value onto this game's 0-99 scale is
 * the one judgement call in `draft-outcomes.ts` — AV is a career total and
 * `trueOverall` is a rookie-year rating, and nothing in the data fixes the
 * relationship between them. What *can* be checked is the consequence: how
 * often each round produces a player good enough to start, against how often
 * each round really did (3,562 picks, 2006-2019).
 */
describe("draft classes against the real thing", () => {
  const STARTER = 68; // the rating at which a rookie is a plausible NFL starter

  function starterRateByRound(seed: number): Record<number, number> {
    const klass = new MockSimulationService().generateDraftClass(seed, 2027);
    const out: Record<number, number> = {};
    for (let round = 1; round <= 7; round++) {
      const picks = klass.slice((round - 1) * 32, round * 32);
      out[round] = picks.filter((p) => p.trueOverall >= STARTER).length / picks.length;
    }
    return out;
  }

  it("produces starters at roughly the rate each round really does", () => {
    // averaged over several classes, since one class is only 32 picks a round
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (let round = 1; round <= 7; round++) {
      const modelled =
        seeds.reduce((n, s) => n + starterRateByRound(s)[round]!, 0) / seeds.length;
      const real = REAL_STARTER_RATE_BY_ROUND[round]!;
      // within 20 points: the mapping is anchored, not fitted, and "started a
      // season" is a career outcome while this is a day-one rating
      expect(Math.abs(modelled - real), `round ${round}: ${modelled.toFixed(2)} vs ${real}`).toBeLessThan(0.2);
    }
  });

  it("falls off round by round, the way the board does", () => {
    const rates = starterRateByRound(11);
    expect(rates[1]).toBeGreaterThan(rates[4]!);
    expect(rates[4]).toBeGreaterThan(rates[7]!);
  });

  it("is less predictable the further down the board it goes", () => {
    const klass = new MockSimulationService().generateDraftClass(5, 2027);
    const spread = (from: number, to: number): number => {
      const xs = klass.slice(from, to).map((p) => p.trueOverall);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    };
    // a top-ten pick is a fairly known quantity; a seventh-rounder is a
    // lottery ticket, and that gap is the whole reason scouting is a job
    expect(spread(160, 224)).toBeGreaterThan(spread(0, 32));
  });
});

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
