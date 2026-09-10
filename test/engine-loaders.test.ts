import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  applyShift,
  sampleAirYards,
  sampleDpiYards,
  sampleExactYards,
  samplePenaltyBucket,
  samplePuntDistance,
  samplePuntReturn,
  sampleRunoff,
} from "../src/engine/loaders.js";
import { Rng } from "../src/engine/rng.js";

const fx = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/loader_cases.json", import.meta.url)), "utf8"),
) as {
  samplers: Record<string, Record<string, unknown>[]>;
  apply_shift: { base: Record<string, number>; shift: Record<string, number>; expected: Record<string, number> }[];
};

/** An Rng whose `random()` returns a fixed queue — for replaying Python draws. */
function fixed(values: number[]): Rng {
  let i = 0;
  return { random: () => values[i++] ?? 0 } as unknown as Rng;
}

describe("engine sampler parity with Python", () => {
  it("sampleExactYards (m10/m11/m14)", () => {
    for (const c of fx.samplers.exact as { stem: string; cat: string; bucket: string; r: number; v: number }[]) {
      expect(sampleExactYards(c.stem, c.cat, c.bucket, fixed([c.r]))).toBe(c.v);
    }
  });

  it("sampleAirYards", () => {
    for (const c of fx.samplers.air as { cat: string; down: number; fp: string; r: number; v: number }[]) {
      const yl = c.fp === "opp_rz" ? 15 : c.fp === "opp_mid" ? 40 : 75;
      expect(sampleAirYards(c.cat, c.down, yl, fixed([c.r]))).toBe(c.v);
    }
  });

  it("sampleRunoff", () => {
    for (const c of fx.samplers.clock as { bucket: string; nh: number; cs: string; r: number; v: number }[]) {
      expect(sampleRunoff(c.bucket, c.nh, c.cs, fixed([c.r]))).toBe(c.v);
    }
  });

  it("samplePuntDistance / samplePuntReturn", () => {
    for (const c of fx.samplers.punt_dist as { r: number; v: number }[]) {
      // fixture uses the fp=40 table; yardline 45 → trunc(45/10)*10 = 40
      expect(samplePuntDistance(45, fixed([c.r]))).toBe(c.v);
    }
    for (const c of fx.samplers.punt_ret as { r: number; v: number }[]) {
      expect(samplePuntReturn(fixed([c.r]))).toBe(c.v);
    }
  });

  it("sampleDpiYards", () => {
    for (const c of fx.samplers.dpi as { band: string; r: number; v: number }[]) {
      expect(sampleDpiYards(c.band, fixed([c.r]))).toBe(c.v);
    }
  });

  it("samplePenaltyBucket", () => {
    for (const c of fx.samplers.penbucket as { hz: string; fam: string; r: number; bucket: string }[]) {
      expect(samplePenaltyBucket(c.hz, c.fam, fixed([c.r])).bucket).toBe(c.bucket);
    }
  });
});

describe("Rng", () => {
  it("random() is uniform on [0,1)", () => {
    const g = new Rng(42);
    let sum = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < 20000; i++) {
      const x = g.random();
      sum += x;
      min = Math.min(min, x);
      max = Math.max(max, x);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
  });

  it("is deterministic per seed", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 100; i++) expect(a.random()).toBe(b.random());
    expect(new Rng(8).random()).not.toBe(new Rng(7).random());
  });

  it("normal(0,1) has ~0 mean and ~1 sd", () => {
    const g = new Rng(123);
    const xs = Array.from({ length: 40000 }, () => g.normal(0, 1));
    const mean = xs.reduce((p, q) => p + q, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((p, q) => p + (q - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });

  it("choice respects weights", () => {
    const g = new Rng(99);
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < 30000; i++) {
      const pick = g.choice(["a", "b", "c"], [0.6, 0.3, 0.1]);
      counts[pick] = (counts[pick] ?? 0) + 1;
    }
    expect((counts.a ?? 0) / 30000).toBeCloseTo(0.6, 1);
    expect((counts.b ?? 0) / 30000).toBeCloseTo(0.3, 1);
    expect((counts.c ?? 0) / 30000).toBeCloseTo(0.1, 1);
  });
});

describe("applyShift (re-softmax) parity with Python _apply_shift", () => {
  it("matches on every fixture case", () => {
    for (const c of fx.apply_shift) {
      const got = applyShift(c.base, c.shift);
      for (const [l, exp] of Object.entries(c.expected)) {
        expect(got[l]).toBeCloseTo(exp, 12);
      }
    }
  });
});
