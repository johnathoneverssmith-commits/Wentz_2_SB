/**
 * Seeded, reproducible chance for the simulation. The engine is a pure function of its state, so the chance is too: a game carries one
 * 32-bit `seed`, and every roll is a hash of that seed and the facts that identify the event (which play, which tick, what is rolled for).
 * There is no generator whose position would have to be saved, advanced or kept in step: the same state always gives the same roll, a
 * saved game resumes to the same outcome, and two rolls of different events do not depend on the order they are made in.
 */
export const DEFAULT_SEED = 1;
const UINT32 = 0x100000000;

/** Folds one integer into a running 32-bit hash (the murmur3 mixing step), so every input changes every output bit. */
function fold(h: number, part: number): number {
    let k = Math.imul(part | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    return (Math.imul(h, 5) + 0xe6546b64) | 0;
}
/** The murmur3 finalizer: spreads the last input over all 32 bits. */
function finish(h: number): number {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
}
/** One unsigned 32-bit integer from any list of integers. Order matters; the same list always gives the same number. */
export function mix(...parts: readonly number[]): number {
    let h = 0x9747b28c;
    for (const p of parts) h = fold(h, p);
    return finish(h ^ parts.length);
}
/** A number in [0, 1) that depends only on the seed and the keys. `roll(seed, playNumber, tick, kind)` is the same on every machine and every run. */
export const roll = (seed: number, ...keys: readonly number[]): number => mix(seed, ...keys) / UINT32;
/** A seed is an unsigned 32-bit integer. */
export const validSeed = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < UINT32;
