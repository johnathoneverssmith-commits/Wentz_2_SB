import { Rng } from "../rng.ts";

/**
 * Independent random streams for League DNA.
 *
 * Each stream is named, and its seed is a hash of the league's DNA seed and
 * that name alone. Nothing here reads gameplay RNG, and one stream never
 * advances another, so adding a player, a position or a draft year cannot
 * change anyone else's numbers.
 */
export function hash32(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // final avalanche so near-identical labels decorrelate
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function stream(dnaSeed: number, ...label: (string | number)[]): Rng {
  return new Rng(hash32(dnaSeed, ...label));
}

/** The 32-bit DNA seed for a league. `seed` can be as small as 17 bits (online), so it is spread first. */
export function dnaSeedFor(seed: number, version: number): number {
  return hash32("league-dna", version, seed);
}
