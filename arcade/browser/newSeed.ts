import { DEFAULT_SEED, validSeed } from '../core/seed';
/**
 * The seed for a new game. A visit to `?seed=N` plays the same game every time (for tests and for sharing a situation); otherwise the
 * browser's secure random source picks one. This is the only place outside the balance tools that draws a random number: the
 * simulation itself never does, it only reads the seed it was given.
 */
export function newSeed(search: string = typeof location === 'undefined' ? '' : location.search): number {
    const asked = new URLSearchParams(search).get('seed');
    if (asked !== null && /^\d{1,10}$/.test(asked) && validSeed(Number(asked))) return Number(asked);
    try {
        const out = new Uint32Array(1);
        crypto.getRandomValues(out);
        return out[0]!;
    }
    catch {
        return DEFAULT_SEED;
    }
}
