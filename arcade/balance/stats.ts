/** The statistics the balance reports use. Pure functions, tested against hand-computed values. */

export interface Interval { readonly lo: number; readonly hi: number }
export interface Proportion { readonly k: number; readonly n: number; readonly p: number; readonly ci: Interval }
export interface Summary { readonly n: number; readonly mean: number; readonly sd: number; readonly se: number; readonly ci: Interval; readonly min: number; readonly max: number }

const Z95 = 1.959964;

/** Wilson score interval for k successes in n trials (well behaved at 0, at n and at small n, unlike the normal approximation). */
export function wilson(k: number, n: number, z = Z95): Interval {
    if (n <= 0) return { lo: 0, hi: 1 };
    if (k < 0 || k > n) throw new Error('successes must be between 0 and n');
    const p = k / n, z2 = z * z, denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom, half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom;
    // at k = 0 the lower bound is exactly 0 and at k = n the upper bound is exactly 1; floating point leaves a rounding sliver, so say so
    return { lo: k === 0 ? 0 : Math.max(0, centre - half), hi: k === n ? 1 : Math.min(1, centre + half) };
}
export const proportion = (k: number, n: number): Proportion => ({ k, n, p: n ? k / n : 0, ci: wilson(k, n) });

/** Mean, sample standard deviation and a 95% normal interval for the mean. */
export function summarize(values: readonly number[]): Summary {
    const n = values.length;
    if (n === 0) return { n: 0, mean: 0, sd: 0, se: 0, ci: { lo: 0, hi: 0 }, min: 0, max: 0 };
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    const se = n > 1 ? sd / Math.sqrt(n) : 0;
    return { n, mean, sd, se, ci: { lo: mean - Z95 * se, hi: mean + Z95 * se }, min: Math.min(...values), max: Math.max(...values) };
}

/** Linear-interpolated percentile (q in [0, 1]) of the values. */
export function percentile(values: readonly number[], q: number): number {
    if (!values.length) return NaN;
    const v = [...values].sort((a, b) => a - b), pos = Math.min(1, Math.max(0, q)) * (v.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo]! + (v[hi]! - v[lo]!) * (pos - lo);
}

/** Counts of each value, ordered by value: a scoring distribution. */
export function distribution(values: readonly number[]): { value: number; count: number; share: number }[] {
    const counts = new Map<number, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count, share: count / values.length }));
}

/**
 * Difference of two proportions (a - b) with a 95% interval (Newcombe's hybrid score method, built from the two Wilson intervals).
 * `significant` means the interval excludes 0.
 */
export function compareProportions(a: Proportion, b: Proportion): { diff: number; ci: Interval; significant: boolean } {
    const diff = a.p - b.p;
    const lo = diff - Math.sqrt((a.p - a.ci.lo) ** 2 + (b.ci.hi - b.p) ** 2), hi = diff + Math.sqrt((a.ci.hi - a.p) ** 2 + (b.p - b.ci.lo) ** 2);
    return { diff, ci: { lo, hi }, significant: lo > 0 || hi < 0 };
}
/** Difference of two means (a - b), 95% interval from the two standard errors. */
export function compareMeans(a: Summary, b: Summary): { diff: number; ci: Interval; significant: boolean } {
    const diff = a.mean - b.mean, se = Math.sqrt(a.se ** 2 + b.se ** 2);
    return { diff, ci: { lo: diff - Z95 * se, hi: diff + Z95 * se }, significant: se > 0 && Math.abs(diff) > Z95 * se };
}

/** Longest run of consecutive true values (how wide an open window is). */
export function longestRun(flags: readonly boolean[]): number {
    let best = 0, run = 0;
    for (const f of flags) { run = f ? run + 1 : 0; if (run > best) best = run; }
    return best;
}
