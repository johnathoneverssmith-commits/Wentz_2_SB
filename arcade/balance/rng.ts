/**
 * Seeded randomness for the balance tools. The gameplay engine has no randomness at all and this does not add any: only the scripted
 * players (which play, which receiver, when to throw) draw from these streams, so a seed reproduces a measurement exactly.
 */
export interface Rng {
    /** A float in [0, 1). */
    next(): number;
    /** An integer in [lo, hi], both ends included. */
    int(lo: number, hi: number): number;
    pick<T>(items: readonly T[]): T;
    chance(p: number): boolean;
}

/** mulberry32: a small, well-distributed 32-bit generator. */
export function rng(seed: number): Rng {
    let a = seed >>> 0;
    const next = (): number => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
        pick: items => items[Math.floor(next() * items.length)]!,
        chance: p => next() < p,
    };
}

/** FNV-1a over the parts: independent, repeatable streams from (seed, strategy, defense, drive...) without sharing state. */
export function hashSeed(...parts: (string | number)[]): number {
    let h = 0x811c9dc5;
    for (const ch of parts.join('\u001f')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
}

/** The stream for one named purpose under one seed. */
export const streamFor = (seed: number, ...label: (string | number)[]): Rng => rng(hashSeed(seed, ...label));
