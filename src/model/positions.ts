/**
 * Per-position model constants.
 *
 * These are hand-set v0 priors, not measured values. They exist so the pool
 * generator and the Madden importer produce plausible-looking players (fast
 * receivers, slow guards, rare 95-overall quarterbacks). Calibration against
 * real outcomes is Phase 7 work — see docs/decisions.md (OQ-2, OQ-4).
 */

import type { Position } from "../schema/player.js";

/** When upward drift stops (dev) and downward drift begins (decline). OQ-4. */
export const AGING_CURVES: Readonly<Record<Position, { dev: number; decline: number }>> = {
  QB: { dev: 28, decline: 34 },
  RB: { dev: 24, decline: 28 },
  WR: { dev: 26, decline: 30 },
  TE: { dev: 26, decline: 31 },
  OT: { dev: 27, decline: 33 },
  OG: { dev: 27, decline: 33 },
  C: { dev: 27, decline: 33 },
  EDGE: { dev: 26, decline: 31 },
  DT: { dev: 27, decline: 31 },
  LB: { dev: 26, decline: 31 },
  CB: { dev: 25, decline: 30 },
  S: { dev: 26, decline: 31 },
  K: { dev: 30, decline: 40 },
  P: { dev: 30, decline: 40 },
};

/** The general attributes that are body-type driven, not skill driven. */
export const PHYSICAL_ATTRIBUTES = [
  "speed",
  "acceleration",
  "agility",
  "strength",
  "jumping",
] as const;
export type PhysicalAttribute = (typeof PHYSICAL_ATTRIBUTES)[number];

/**
 * League-average physical ratings for a rostered player at each position.
 * The generator centres a player's physicals here and nudges by overall.
 */
export const POSITION_PHYSICAL_BASE: Readonly<
  Record<Position, Readonly<Record<PhysicalAttribute, number>>>
> = {
  QB: { speed: 76, acceleration: 78, agility: 78, strength: 62, jumping: 66 },
  RB: { speed: 89, acceleration: 90, agility: 88, strength: 70, jumping: 78 },
  WR: { speed: 90, acceleration: 91, agility: 88, strength: 60, jumping: 88 },
  TE: { speed: 82, acceleration: 83, agility: 79, strength: 78, jumping: 80 },
  OT: { speed: 70, acceleration: 72, agility: 66, strength: 87, jumping: 60 },
  OG: { speed: 67, acceleration: 70, agility: 64, strength: 89, jumping: 58 },
  C: { speed: 66, acceleration: 69, agility: 64, strength: 87, jumping: 58 },
  EDGE: { speed: 83, acceleration: 85, agility: 80, strength: 83, jumping: 78 },
  DT: { speed: 73, acceleration: 76, agility: 68, strength: 90, jumping: 66 },
  LB: { speed: 84, acceleration: 86, agility: 82, strength: 78, jumping: 78 },
  CB: { speed: 91, acceleration: 92, agility: 90, strength: 58, jumping: 88 },
  S: { speed: 88, acceleration: 89, agility: 86, strength: 66, jumping: 85 },
  K: { speed: 55, acceleration: 58, agility: 55, strength: 55, jumping: 52 },
  P: { speed: 55, acceleration: 58, agility: 55, strength: 54, jumping: 52 },
};

/**
 * Overall = `base` (a low-pedigree rostered player) + `spread` * pedigree
 * (a first-overall pick) + age/role/noise adjustments.
 */
export const POSITION_OVERALL_PRIOR: Readonly<
  Record<Position, { base: number; spread: number }>
> = {
  QB: { base: 58, spread: 34 },
  RB: { base: 66, spread: 22 },
  WR: { base: 66, spread: 24 },
  TE: { base: 66, spread: 20 },
  OT: { base: 64, spread: 24 },
  OG: { base: 66, spread: 20 },
  C: { base: 66, spread: 20 },
  EDGE: { base: 64, spread: 26 },
  DT: { base: 65, spread: 22 },
  LB: { base: 65, spread: 21 },
  CB: { base: 64, spread: 24 },
  S: { base: 65, spread: 21 },
  K: { base: 70, spread: 16 },
  P: { base: 70, spread: 14 },
};

/** Which schema positions get a `jumping` rating written (skill-position bodies). */
export const JUMPING_POSITIONS: ReadonlySet<Position> = new Set<Position>([
  "WR",
  "TE",
  "RB",
  "CB",
  "S",
  "LB",
  "EDGE",
]);
