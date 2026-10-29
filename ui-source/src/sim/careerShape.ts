import type { Position } from "@/domain";

import { Rng } from "./rng.ts";

/**
 * The shape of one player's career, on top of the two ages stored on him.
 *
 * Nothing here is stored. A player's stored `dev_age_threshold` and
 * `decline_age_threshold` stay exactly as they were written, so every existing
 * save keeps its players; the shape is worked out from his position and his id
 * each time it is needed, so it is the same in every league client, any order,
 * after any reload.
 *
 * Position: when a position's players finish developing (a running back peaks
 * early, a quarterback or lineman late) and how steeply they fall once they
 * decline. Person: an early or late bloomer, a player who tops out early or
 * keeps climbing, and a steady or streaky one. These are design choices, not
 * measurements of the NFL; the measured outcomes are in
 * `docs/PD2_aging_development.md`.
 */
export interface CareerShape {
  /** years added to his development age: positive peaks later */
  devShift: number;
  /** years added to his decline age: early bloomers fall sooner, late ones later */
  declineShift: number;
  /** multiplier on how much he grows each year */
  growth: number;
  /** multiplier on how steeply he declines */
  slope: number;
  /** multiplier on year-to-year spread, and on how often a breakout or slump happens */
  volatility: number;
}

export const NEUTRAL_SHAPE: CareerShape = { devShift: 0, declineShift: 0, growth: 1, slope: 1, volatility: 1 };

/** Years a position's development age moves from the stored one, and how hard its decline lands. */
export const POSITION_CAREER: Readonly<Record<Position, { devShift: number; slope: number }>> = {
  QB: { devShift: 2, slope: 0.8 },
  RB: { devShift: -2, slope: 1.25 },
  WR: { devShift: -1, slope: 1.0 },
  TE: { devShift: 0, slope: 0.95 },
  OT: { devShift: 1, slope: 0.85 },
  OG: { devShift: 1, slope: 0.85 },
  C: { devShift: 1, slope: 0.85 },
  EDGE: { devShift: 0, slope: 1.0 },
  DT: { devShift: 0, slope: 0.95 },
  ILB: { devShift: -1, slope: 1.0 },
  OLB: { devShift: -1, slope: 1.0 },
  CB: { devShift: -1, slope: 1.1 },
  S: { devShift: 0, slope: 0.95 },
  K: { devShift: 2, slope: 0.5 },
  P: { devShift: 2, slope: 0.5 },
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** A new rookie's decline age is his position's outer age less this many years (inclusive range). */
export const ROOKIE_DECLINE_BACKOFF: readonly [number, number] = [0, 4];

function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Early bloomers 20%, late 20%, very late 5%; growth: plateau 15%, steady 70%, climber 15%; volatility 30/40/30. */
export function careerShape(p: { id: string; position: Position }): CareerShape {
  const rng = new Rng(hashId(`career|${p.id}`));
  const b = rng.random();
  const bloom = b < 0.2 ? -1 : b < 0.75 ? 0 : b < 0.95 ? 1 : 2;
  const g = rng.random();
  const growth = g < 0.15 ? 0.7 : g < 0.85 ? 1 : 1.3;
  const v = rng.random();
  const volatility = v < 0.3 ? 0.8 : v < 0.7 ? 1 : 1.4;
  const pos = POSITION_CAREER[p.position] ?? { devShift: 0, slope: 1 };
  const devShift = pos.devShift + bloom;
  // a shorter developing window grows faster and a longer one slower, so a position that peaks early or
  // late reaches about the same level at a different age rather than a lower one
  const window = clamp(4 / (4 + devShift), 0.7, 1.6);
  return {
    devShift,
    declineShift: Math.sign(bloom),
    growth: growth * window,
    slope: pos.slope,
    volatility,
  };
}
