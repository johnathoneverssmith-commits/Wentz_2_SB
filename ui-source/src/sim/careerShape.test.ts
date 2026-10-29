import { describe, expect, it } from "vitest";

import type { Position } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "../state/seed.ts";
import { upsertRookiePlayer } from "../state/rules.ts";
import { agingDelta, MockSimulationService, retirementChance } from "./MockSimulationService.ts";
import { careerShape, NEUTRAL_SHAPE, POSITION_CAREER } from "./careerShape.ts";
import { RETIREMENT_AGE } from "./roster-template.ts";
import { Rng } from "./rng.ts";

/**
 * PD-2: position curves and individual careers. Statistical assertions use large cohorts and only
 * the direction or ordering that the design promises, never an exact average.
 */
const hash = (id: string): number => Array.from(id).reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5);

function career(position: Position, id: string, start = 22, overall = 70): { ages: number[]; ovr: number[] } {
  const p = { id, position, age: start, overall, potential: overall + 12, dev_age_threshold: start + 4, decline_age_threshold: Math.max(start + 7, RETIREMENT_AGE[position] - 4) };
  const shape = careerShape(p);
  const ages = [p.age];
  const ovr = [p.overall];
  for (let y = 0; y < 22; y++) {
    const d = agingDelta(new Rng((2030 + y) * 9151 ^ hash(id)), p.age, p.dev_age_threshold, p.decline_age_threshold, p.potential - p.overall, shape);
    p.overall = Math.max(40, Math.min(99, p.overall + d));
    ages.push(p.age);
    ovr.push(p.overall);
    p.age++;
  }
  return { ages, ovr };
}
const peakAge = (c: { ages: number[]; ovr: number[] }): number => c.ages[c.ovr.indexOf(Math.max(...c.ovr))]!;
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

describe("careerShape", () => {
  it("is a function of the id and position alone", () => {
    expect(careerShape({ id: "p_1", position: "QB" })).toEqual(careerShape({ id: "p_1", position: "QB" }));
    expect(careerShape({ id: "p_1", position: "QB" })).not.toEqual(careerShape({ id: "p_2", position: "QB" }));
  });
  it("survives a save and reload, and does not care how players are ordered or stored", () => {
    const s = createLeague(4, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const ps = Object.values(s.players);
    const direct = ps.map((p) => careerShape(p));
    const reloaded = (JSON.parse(JSON.stringify(ps)) as typeof ps).reverse().map((p) => careerShape(p)).reverse();
    expect(reloaded).toEqual(direct);
  });
  it("gives a spread of early, normal and late bloomers, plateaus and climbers, and streaky and steady players", () => {
    const shapes = Array.from({ length: 2000 }, (_, i) => careerShape({ id: `p_${i}`, position: "WR" }));
    const share = (f: (s: ReturnType<typeof careerShape>) => boolean): number => shapes.filter(f).length / shapes.length;
    const base = POSITION_CAREER.WR.devShift;
    expect(share((s) => s.devShift < base)).toBeGreaterThan(0.1);
    expect(share((s) => s.devShift > base)).toBeGreaterThan(0.1);
    expect(share((s) => s.growth < 1)).toBeGreaterThan(0.05);
    expect(share((s) => s.growth > 1)).toBeGreaterThan(0.05);
    expect(share((s) => s.volatility < 1)).toBeGreaterThan(0.1);
    expect(share((s) => s.volatility > 1)).toBeGreaterThan(0.1);
    expect(mean(shapes.map((s) => s.volatility))).toBeGreaterThan(0.95);
    expect(mean(shapes.map((s) => s.volatility))).toBeLessThan(1.1);
  });
});

describe("position-specific aging", () => {
  const cohort = (position: Position): ReturnType<typeof career>[] => Array.from({ length: 400 }, (_, i) => career(position, `${position}_${i}`));
  it("peaks a running back and a cornerback earlier than a quarterback or a tackle", () => {
    const rb = mean(cohort("RB").map(peakAge));
    const cb = mean(cohort("CB").map(peakAge));
    const ot = mean(cohort("OT").map(peakAge));
    const qb = mean(cohort("QB").map(peakAge));
    expect(qb - rb).toBeGreaterThan(2);
    expect(qb - cb).toBeGreaterThan(1.5);
    expect(ot).toBeGreaterThan(rb + 1);
  });
  it("lets a back fall faster than a quarterback once both decline, and a kicker barely at all", () => {
    const lossAt = (position: Position): number =>
      mean(Array.from({ length: 1500 }, (_, i) => agingDelta(new Rng(i * 31 + 7), 33, 25, 30, undefined, careerShape({ id: `${position}_${i}`, position }))));
    expect(lossAt("RB")).toBeLessThan(lossAt("QB") - 0.4);
    expect(lossAt("K")).toBeGreaterThan(lossAt("CB") + 0.8);
  });
  it("gives a new rookie his position's outer age, not a flat ten years after the draft", () => {
    const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const rb = s.draftClass.find((d) => d.position === "RB")!;
    const qb = s.draftClass.find((d) => d.position === "QB")!;
    upsertRookiePlayer(s, rb.id, "KC", 1, false);
    upsertRookiePlayer(s, qb.id, "KC", 1, false);
    const r = s.players[`p_rookie_${rb.id}`]!;
    const q = s.players[`p_rookie_${qb.id}`]!;
    expect(r.decline_age_threshold).toBeLessThan(q.decline_age_threshold);
    expect(r.decline_age_threshold).toBeGreaterThanOrEqual(r.age + 7);
    expect(q.dev_age_threshold).toBe(q.age + 4);
  });
});

describe("variance", () => {
  const deltas = (shaped: boolean): number[] => {
    const out: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const id = `v_${i}`;
      const shape = shaped ? careerShape({ id, position: "OT" }) : undefined;
      out.push(agingDelta(new Rng(i * 7919 + 3), 28, 25, 33, undefined, shape));
    }
    return out;
  };
  it("is wider in the prime than the unshaped curve, with rare breakouts and slumps", () => {
    const a = deltas(false);
    const b = deltas(true);
    const sd = (x: number[]): number => Math.sqrt(mean(x.map((v) => (v - mean(x)) ** 2)));
    expect(sd(b)).toBeGreaterThan(sd(a) * 1.2);
    const big = b.filter((d) => Math.abs(d) >= 3).length / b.length;
    expect(big).toBeGreaterThan(0.01);
    expect(big).toBeLessThan(0.15);
    expect(Math.abs(mean(b) - mean(a))).toBeLessThan(0.3);
  });
  it("is deterministic for a seed and unchanged when no shape is given", () => {
    for (const shape of [undefined, careerShape({ id: "p_9", position: "EDGE" })]) {
      const run = (): number[] => Array.from({ length: 30 }, (_, i) => agingDelta(new Rng(i + 1), 24 + (i % 10), 26, 31, 8, shape));
      expect(run()).toEqual(run());
    }
    expect(NEUTRAL_SHAPE.slope).toBe(1);
  });
});

describe("retirement compatibility", () => {
  it("a player the aging model has pushed past his decline age is eligible to retire, as before", () => {
    const p = { position: "RB" as Position, age: 31, overall: 70, decline_age_threshold: 27, injury_history: [] };
    expect(retirementChance(p).eligible).toBe(true);
    expect(retirementChance(p).chance).toBeGreaterThan(0.2);
  });
});

describe("long-term talent stability", () => {
  // Careers of drafted rookies under the shaped model against the unshaped one (flat ages, no shape): position
  // curves and individual variation redistribute talent across ages; they must not create or destroy it.
  it("keeps total career rating, peak level and the share of stars within a few percent of the unshaped model", () => {
    const sim = new MockSimulationService();
    const total = { shaped: 0, plain: 0, n: 0, peakS: 0, peakP: 0, starS: 0, starP: 0 };
    for (let yr = 0; yr < 8; yr++) {
      const cls = sim.generateDraftClass(1000 + yr * 17, 2027 + yr).slice(0, 224);
      cls.forEach((pr, i) => {
        const round = Math.min(7, Math.ceil((i + 1) / 32));
        const r0 = new Rng(hash(pr.id));
        const potential = Math.min(99, pr.trueOverall + Math.max(2, Math.round(r0.normal(9 + Math.max(0, 3 - round) - Math.max(0, pr.age - 21) * 1.5, round <= 2 ? 6 : 4.5))));
        for (const shaped of [true, false]) {
          const p = {
            id: `s${yr}_${i}`, position: pr.position, age: pr.age, overall: pr.trueOverall, potential,
            dev_age_threshold: pr.age + 4,
            decline_age_threshold: shaped ? Math.max(pr.age + 7, RETIREMENT_AGE[pr.position] - 2) : pr.age + 10,
            injury_history: [] as never[],
          };
          const shape = shaped ? careerShape(p) : undefined;
          let sum = 0;
          let peak = p.overall;
          for (let y = 0; y < 22; y++) {
            p.overall = Math.max(40, Math.min(99, p.overall + agingDelta(new Rng((2030 + y) * 9151 ^ hash(p.id)), p.age, p.dev_age_threshold, p.decline_age_threshold, p.potential - p.overall, shape)));
            sum += Math.max(0, p.overall - 70);
            peak = Math.max(peak, p.overall);
            p.age++;
            if (retirementChance(p).eligible && new Rng((2030 + y) * 31 ^ hash(p.id)).random() < retirementChance(p).chance) break;
          }
          if (shaped) { total.shaped += sum; total.peakS += peak; total.starS += peak >= 85 ? 1 : 0; } else { total.plain += sum; total.peakP += peak; total.starP += peak >= 85 ? 1 : 0; }
        }
        total.n++;
      });
    }
    expect(total.shaped / total.plain).toBeGreaterThan(0.9);
    expect(total.shaped / total.plain).toBeLessThan(1.1);
    expect(Math.abs(total.peakS - total.peakP) / total.n).toBeLessThan(1);
    expect(total.starS / total.starP).toBeGreaterThan(0.85);
    expect(total.starS / total.starP).toBeLessThan(1.15);
  });
});
