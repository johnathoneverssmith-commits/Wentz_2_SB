/**
 * Free-agent coaching market (OQ-9 follow-on) — candidates for the UI's coach
 * hiring window, generated on the *same* v0 rating distributions as the 32
 * authored team staffs (`staff-data.ts`), not an arbitrary range. There's no
 * real empirical signal for "coaching ability" the way player ratings have
 * nflverse stats behind them (`staff-data.ts`'s own docs are explicit that
 * those 32 are authored, not measured) — so the honest thing this layer can
 * do is stay *statistically consistent* with that authored baseline rather
 * than invent a wider, disconnected one. Every field's mean/std below is
 * computed from the 32 authored staffs at module load, not hand-picked.
 *
 * Scheme is drawn weighted by how often each scheme actually appears among
 * the 32 (e.g. "multiple" DC and "west_coast" OC are the real plurality) —
 * real frequency, not a uniform pick.
 */
import { Rng } from "./rng.js";
import { allStaffs } from "./staff-data.js";
import type { DefScheme, OffScheme } from "./staff.js";

export type CoachCandidate =
  | { role: "HC"; gameManagement: number; discipline: number; aggression: number }
  | { role: "OC"; rating: number; scheme: OffScheme; passBias: number; tempo: number }
  | { role: "DC"; rating: number; scheme: DefScheme; blitzBias: number };

interface Dist {
  mean: number;
  std: number;
}

function distOf(values: number[]): Dist {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

function weightedFreq<T extends string>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

interface Baseline {
  gameManagement: Dist;
  discipline: Dist;
  aggression: Dist;
  ocRating: Dist;
  passBias: Dist;
  tempo: Dist;
  dcRating: Dist;
  blitzBias: Dist;
  ocScheme: Map<OffScheme, number>;
  dcScheme: Map<DefScheme, number>;
}

let _baseline: Baseline | null = null;

/** The 32 authored staffs' rating distributions — computed once, memoized. */
export function marketBaseline(): Baseline {
  if (_baseline) return _baseline;
  const staffs = Object.values(allStaffs());
  _baseline = {
    gameManagement: distOf(staffs.map((s) => s.headCoach.gameManagement)),
    discipline: distOf(staffs.map((s) => s.headCoach.discipline)),
    aggression: distOf(staffs.map((s) => s.headCoach.aggression)),
    ocRating: distOf(staffs.map((s) => s.oc.rating)),
    passBias: distOf(staffs.map((s) => s.oc.passBias)),
    tempo: distOf(staffs.map((s) => s.oc.tempo)),
    dcRating: distOf(staffs.map((s) => s.dc.rating)),
    blitzBias: distOf(staffs.map((s) => s.dc.blitzBias)),
    ocScheme: weightedFreq(staffs.map((s) => s.oc.scheme)),
    dcScheme: weightedFreq(staffs.map((s) => s.dc.scheme)),
  };
  return _baseline;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

function pickWeighted<T extends string>(rng: Rng, freq: Map<T, number>): T {
  const items = [...freq.keys()];
  const weights = [...freq.values()];
  return rng.choice(items, weights);
}

/** One free-agent HC/OC/DC candidate, sampled from the authored-staff baseline. */
export function generateCandidate(rng: Rng, role: "HC" | "OC" | "DC"): CoachCandidate {
  const b = marketBaseline();
  if (role === "HC") {
    return {
      role,
      gameManagement: clamp(Math.round(rng.normal(b.gameManagement.mean, b.gameManagement.std)), 1, 99),
      discipline: clamp(Math.round(rng.normal(b.discipline.mean, b.discipline.std)), 1, 99),
      aggression: clamp(rng.normal(b.aggression.mean, b.aggression.std), -1, 1),
    };
  }
  if (role === "OC") {
    return {
      role,
      rating: clamp(Math.round(rng.normal(b.ocRating.mean, b.ocRating.std)), 1, 99),
      scheme: pickWeighted(rng, b.ocScheme),
      passBias: clamp(rng.normal(b.passBias.mean, b.passBias.std), -1, 1),
      tempo: clamp(rng.normal(b.tempo.mean, b.tempo.std), -1, 1),
    };
  }
  return {
    role: "DC",
    rating: clamp(Math.round(rng.normal(b.dcRating.mean, b.dcRating.std)), 1, 99),
    scheme: pickWeighted(rng, b.dcScheme),
    blitzBias: clamp(rng.normal(b.blitzBias.mean, b.blitzBias.std), -1, 1),
  };
}

/** A full open market: `counts` candidates per role, deterministic in `seed`. */
export function generateCoachMarket(
  seed: number,
  counts: { hc: number; oc: number; dc: number },
): CoachCandidate[] {
  const rng = new Rng(seed);
  const out: CoachCandidate[] = [];
  for (let i = 0; i < counts.hc; i++) out.push(generateCandidate(rng, "HC"));
  for (let i = 0; i < counts.oc; i++) out.push(generateCandidate(rng, "OC"));
  for (let i = 0; i < counts.dc; i++) out.push(generateCandidate(rng, "DC"));
  return out;
}
