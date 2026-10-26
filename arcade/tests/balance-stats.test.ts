/** The statistics and the seeded randomness behind the balance tools: values checked against hand calculation and published results. */
import { describe, expect, it } from 'vitest';
import { hashSeed, rng, streamFor } from '../balance/rng';
import { compareMeans, compareProportions, distribution, longestRun, percentile, proportion, summarize, wilson } from '../balance/stats';

describe('seeded randomness', () => {
    it('the same seed gives the same stream, a different seed a different one', () => {
        const draw = (seed: number) => { const r = rng(seed); return Array.from({ length: 50 }, () => r.next()); };
        expect(draw(7)).toEqual(draw(7));
        expect(draw(7)).not.toEqual(draw(8));
    });
    it('is pinned: seed 12345 always begins with these values (a changed generator would silently change every report)', () => {
        const r = rng(12345);
        expect([r.next(), r.next(), r.next()].map(x => Number(x.toFixed(10)))).toEqual([0.9797282678, 0.3067522645, 0.4842054215]);
        expect(streamFor(7, 'x').int(1, 100)).toBe(71);
    });
    it('hashSeed is FNV-1a (the published value for "a") and depends on every part, in order', () => {
        expect(hashSeed('a')).toBe(0xe40c292c);
        expect(hashSeed(1, 'deep', 'home', 28)).toBe(525330710);
        expect(hashSeed(1, 2)).not.toBe(hashSeed(2, 1));
        expect(hashSeed(1, 'a')).not.toBe(hashSeed(1, 'b'));
    });
    it('streams for different purposes under one seed are independent', () => {
        expect(streamFor(1, 'a').next()).not.toBe(streamFor(1, 'b').next());
        expect(streamFor(1, 'a').next()).toBe(streamFor(1, 'a').next());
    });
    it('draws stay in range and cover it: floats in [0, 1), integers inclusive of both ends, every value reachable', () => {
        const r = rng(99), seen = new Set<number>();
        for (let i = 0; i < 5000; i++) {
            const f = r.next(); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1);
            const n = r.int(3, 8); expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(8); seen.add(n);
        }
        expect([...seen].sort()).toEqual([3, 4, 5, 6, 7, 8]);
    });
    it('is uniform enough to trust: the mean is near a half and chance(p) fires about p of the time', () => {
        const r = rng(2024);
        const xs = Array.from({ length: 20000 }, () => r.next());
        expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeCloseTo(0.5, 1);
        const c = rng(5); let hits = 0;
        for (let i = 0; i < 20000; i++) if (c.chance(0.3)) hits++;
        expect(hits / 20000).toBeGreaterThan(0.28); expect(hits / 20000).toBeLessThan(0.32);
    });
    it('pick chooses each item about equally', () => {
        const r = rng(3), counts = { a: 0, b: 0, c: 0 };
        for (let i = 0; i < 9000; i++) counts[r.pick(['a', 'b', 'c'] as const)]++;
        for (const v of Object.values(counts)) { expect(v).toBeGreaterThan(2800); expect(v).toBeLessThan(3200); }
    });
});

describe('proportions and intervals', () => {
    it('Wilson interval matches the published values', () => {
        const a = wilson(50, 100); expect(a.lo).toBeCloseTo(0.4038, 3); expect(a.hi).toBeCloseTo(0.5962, 3);
        const b = wilson(5, 20); expect(b.lo).toBeCloseTo(0.1119, 3); expect(b.hi).toBeCloseTo(0.4687, 3);
    });
    it('is sensible at the edges: zero successes still has a positive upper bound, all successes a lower bound below one', () => {
        const none = wilson(0, 10); expect(none.lo).toBe(0); expect(none.hi).toBeCloseTo(0.2775, 3);
        const all = wilson(10, 10); expect(all.hi).toBe(1); expect(all.lo).toBeCloseTo(0.7225, 3);
        expect(wilson(0, 0)).toEqual({ lo: 0, hi: 1 });
        expect(() => wilson(11, 10)).toThrow();
    });
    it('always contains the point estimate, and narrows as the sample grows', () => {
        for (const [k, n] of [[1, 7], [3, 9], [40, 90], [450, 900]] as const) { const p = proportion(k, n); expect(p.ci.lo).toBeLessThanOrEqual(p.p); expect(p.ci.hi).toBeGreaterThanOrEqual(p.p); }
        const w = (n: number) => { const i = wilson(n / 2, n); return i.hi - i.lo; };
        expect(w(1000)).toBeLessThan(w(100)); expect(w(100)).toBeLessThan(w(10));
    });
    it('compares two proportions with Newcombe\'s interval and says whether the difference is real', () => {
        const d = compareProportions(proportion(60, 100), proportion(40, 100));
        expect(d.diff).toBeCloseTo(0.2, 6); expect(d.ci.lo).toBeCloseTo(0.0614, 2); expect(d.ci.hi).toBeCloseTo(0.3281, 2); expect(d.significant).toBe(true);
        const same = compareProportions(proportion(52, 100), proportion(48, 100));
        expect(same.significant).toBe(false); expect(same.ci.lo).toBeLessThan(0);
        expect(compareProportions(proportion(40, 100), proportion(60, 100)).diff).toBeCloseTo(-0.2, 6);
    });
});

describe('means, percentiles and distributions', () => {
    it('summarises a sample: mean, sample standard deviation, standard error and a normal interval', () => {
        const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
        expect(s.n).toBe(8); expect(s.mean).toBe(5); expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 10); expect(s.se).toBeCloseTo(Math.sqrt(32 / 7) / Math.sqrt(8), 10);
        expect(s.ci.lo).toBeCloseTo(5 - 1.959964 * s.se, 6); expect(s.ci.hi).toBeCloseTo(5 + 1.959964 * s.se, 6); expect([s.min, s.max]).toEqual([2, 9]);
        expect(summarize([3])).toMatchObject({ n: 1, mean: 3, sd: 0, se: 0 });
        expect(summarize([]).n).toBe(0);
    });
    it('interpolates percentiles', () => {
        expect(percentile([1, 2, 3, 4], 0)).toBe(1); expect(percentile([1, 2, 3, 4], 1)).toBe(4); expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5); expect(percentile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 10);
        expect(percentile([9, 1, 5], 0.5)).toBe(5); expect(percentile([], 0.5)).toBeNaN();
    });
    it('builds a distribution ordered by value whose shares sum to one', () => {
        const d = distribution([7, 0, 0, 3, 7, 7, 0, 0]);
        expect(d).toEqual([{ value: 0, count: 4, share: 0.5 }, { value: 3, count: 1, share: 0.125 }, { value: 7, count: 3, share: 0.375 }]);
        expect(d.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 12);
    });
    it('compares two means with their combined standard error', () => {
        const mk = (mean: number, se: number) => ({ n: 100, mean, sd: se * 10, se, ci: { lo: mean - 1.96 * se, hi: mean + 1.96 * se }, min: 0, max: 0 });
        const not = compareMeans(mk(10, 1), mk(8, 1)); expect(not.diff).toBe(2); expect(not.ci.lo).toBeCloseTo(2 - 1.959964 * Math.SQRT2, 5); expect(not.significant).toBe(false);
        expect(compareMeans(mk(10, 0.5), mk(8, 0.5)).significant).toBe(true);
        expect(compareMeans(mk(8, 0.5), mk(10, 0.5)).diff).toBe(-2);
    });
    it('finds the longest unbroken run', () => {
        expect(longestRun([])).toBe(0); expect(longestRun([false, false])).toBe(0); expect(longestRun([true, true, false, true, true, true, false])).toBe(3); expect(longestRun([true, true, true])).toBe(3);
    });
});
