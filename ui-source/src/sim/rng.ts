/**
 * Deterministic RNG — port of `nfl-franchise-sim/src/engine/rng.ts` so mock
 * results are reproducible and a later swap to the real engine is comparable.
 * Mulberry32 core + the helpers the mock sim needs.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    // spread the seed so small integer seeds still decorrelate
    this.s = (seed ^ 0x9e3779b9) >>> 0;
  }

  /** uniform [0, 1) */
  random(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** integer in [lo, hi] inclusive */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.random() * (hi - lo + 1));
  }

  /** float in [lo, hi) */
  float(lo: number, hi: number): number {
    return lo + this.random() * (hi - lo);
  }

  /** approx standard normal via sum of uniforms, scaled */
  normal(mean = 0, sd = 1): number {
    let x = 0;
    for (let i = 0; i < 6; i++) x += this.random();
    return mean + ((x - 3) / Math.sqrt(0.5)) * sd;
  }

  bool(pTrue = 0.5): boolean {
    return this.random() < pTrue;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.random() * arr.length)]!;
  }

  /** weighted pick: `weights` parallel to `arr`. */
  weighted<T>(arr: readonly T[], weights: readonly number[]): T {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.random() * total;
    for (let i = 0; i < arr.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return arr[i]!;
    }
    return arr[arr.length - 1]!;
  }

  shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
