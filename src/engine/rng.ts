/**
 * Seeded PRNG for the simulation engine — the TS counterpart to
 * `numpy.random.default_rng(seed)` as used in `analysis/engine/`.
 *
 * Not a bit-for-bit match of numpy's PCG64 (that needs 64-bit int math);
 * this is `sfc32` (Small Fast Counting, period ~2^128, passes PractRand),
 * seeded through `splitmix32`. Statistical equivalence is all the game loop
 * needs. Same three surface methods the Python engine uses: `random()`,
 * `choice(items, probs)`, `normal(loc, scale)`.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  private spareNormal: number | null = null;

  constructor(seed: number) {
    let s = seed >>> 0;
    const splitmix32 = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.a = splitmix32();
    this.b = splitmix32();
    this.c = splitmix32();
    this.d = splitmix32();
    for (let i = 0; i < 15; i++) this.u32(); // discard startup transient
  }

  /** raw uint32 */
  private u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** float in [0, 1) */
  random(): number {
    return this.u32() / 4294967296;
  }

  /**
   * Weighted pick, mirroring `numpy.random.Generator.choice(items, p=probs)`.
   * `probs` is normalised defensively; a searchsorted on the CDF selects.
   */
  choice<T>(items: readonly T[], probs: readonly number[]): T {
    let total = 0;
    for (const p of probs) total += p > 0 ? p : 0;
    const r = this.random() * (total || 1);
    let acc = 0;
    for (let i = 0; i < items.length; i++) {
      acc += Math.max(probs[i] ?? 0, 0);
      if (r < acc) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  /** Gaussian via Box–Muller (polar form spare kept for the next call). */
  normal(loc = 0, scale = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return loc + scale * z;
    }
    const u1 = 1 - this.random(); // (0, 1] — avoids log(0)
    const u2 = this.random();
    const mag = Math.sqrt(-2 * Math.log(u1));
    this.spareNormal = mag * Math.sin(2 * Math.PI * u2);
    return loc + scale * (mag * Math.cos(2 * Math.PI * u2));
  }
}
