/**
 * Coaching → resolver nudges (spec §16), the staff analogue of `ratings.ts`.
 *
 * Every function is pure and returns a logit/yard delta or a multiplier. All
 * coefficients are small on purpose — a best-vs-worst *whole staff* (as authored
 * in `staff-data.ts`, roughly a ±0.4 rating-norm spread) lands around 3–4 points
 * per team-game, so individual games barely move and §22 is unaffected. A
 * `leagueAverageStaff` produces exactly zero from every function here.
 *
 * v0 uses only the quality ratings and the explicit tendency knobs. Scheme fit
 * (`scheme_tags` × coordinator scheme) is modelled on the `Staff` type but not
 * yet wired — it needs per-scheme league centering to stay neutral, deferred to
 * v0.1.
 *
 * Kept behaviourally identical to `analysis/engine/staff_shift.py`.
 */

import {
  type DefensiveCoordinator,
  type HeadCoach,
  type OffensiveCoordinator,
  ratingNorm,
} from "./staff.js";

// --- coefficients (tunable v0) ---
const HC_GO_AGGRESSION = 0.38; // logit on M01 GO_FOR_IT per unit of aggression
const HC_GO_GAMEPLAN = 0.08; // + a nudge from game-management rating
const HC_PENALTY_SWING = 0.08; // ± fraction of penalty volume across the discipline range

const OC_COMPLETE = 0.028; // M09 COMPLETE logit at rating norm ±1
const OC_RUSH = 0.15; // M14 yards/carry at rating norm ±1
const OC_TEMPO_RUNOFF = 0.05; // fraction taken off snap runoff at tempo ±1

const DC_COMPLETE = 0.028; // M09 COMPLETE suppressed at rating norm ±1
const DC_RUSH = 0.15; // M14 yards/carry suppressed at rating norm ±1
const DC_SACK = 0.06; // M04 SACK logit added at rating norm ±1
const DC_BLITZ_SACK = 0.14; // M04 SACK logit per unit of blitz bias
const DC_BLITZ_COMPLETE = 0.09; // M09 COMPLETE the offense gets back when the blitz is beaten

// --- head coach ---

/** Multiplier on the pre-snap / live-ball penalty hazard (disciplined → < 1). */
export function hcPenaltyScale(hc: HeadCoach): number {
  return 1 - HC_PENALTY_SWING * ratingNorm(hc.discipline);
}

/** Logit delta on the M01 GO_FOR_IT class. */
export function hcGoForItDelta(hc: HeadCoach): number {
  return HC_GO_AGGRESSION * hc.aggression + HC_GO_GAMEPLAN * ratingNorm(hc.gameManagement);
}

// --- offensive coordinator ---

/** Multiplier on snap runoff (faster tempo → < 1). */
export function ocTempoScale(oc: OffensiveCoordinator): number {
  return 1 - OC_TEMPO_RUNOFF * oc.tempo;
}

/** Possessing team's OC contribution: a COMPLETE logit delta + a rush yд/carry delta. */
export function ocOffenseShift(oc: OffensiveCoordinator): { complete: number; rush: number } {
  const q = ratingNorm(oc.rating);
  return { complete: OC_COMPLETE * q, rush: OC_RUSH * q };
}

// (kept `0 - x` rather than `-x` so a neutral coordinator returns +0, not -0)

// --- defensive coordinator ---

/**
 * Defending DC contribution, as deltas to apply to the *offense's* resolver
 * shifts: `complete`/`rush` are negative (suppression), `sack` positive (more
 * sacks against the offense). Includes the blitz bias — extra pressure, but also
 * extra completions when it's beaten.
 */
export function dcDefenseShift(dc: DefensiveCoordinator): {
  complete: number;
  rush: number;
  sack: number;
} {
  const q = ratingNorm(dc.rating);
  return {
    complete: DC_BLITZ_COMPLETE * dc.blitzBias - DC_COMPLETE * q,
    rush: 0 - DC_RUSH * q,
    sack: DC_SACK * q + DC_BLITZ_SACK * dc.blitzBias,
  };
}
