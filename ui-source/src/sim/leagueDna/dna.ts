import type { Position } from "@/domain";
import { POSITIONS } from "@/domain";
import { ARCHETYPES_BY_POSITION } from "./archetypes.ts";
import { stream } from "./streams.ts";

/** Bump when generation changes. A league keeps the version it was made with. */
export const GEN_VERSION = 1;

/**
 * What a "typical" league looks like, per position: mean and sd of overall
 * across every player at the position (starters and depth), and the mean age.
 * Measured on the shipped real-player pool the game used to start from, so a
 * league whose DNA is all zeros is today's league in shape.
 */
export const REFERENCE: Readonly<Record<Position, { mean: number; sd: number; age: number; ageSd: number }>> = {
  QB: { mean: 72.3, sd: 9.8, age: 28.3, ageSd: 4.2 },
  RB: { mean: 72.5, sd: 6.7, age: 25.8, ageSd: 2.7 },
  WR: { mean: 72.5, sd: 7.4, age: 26.2, ageSd: 3.0 },
  TE: { mean: 71.8, sd: 5.7, age: 26.7, ageSd: 3.2 },
  OT: { mean: 72.6, sd: 7.8, age: 27.1, ageSd: 3.4 },
  OG: { mean: 72.7, sd: 6.5, age: 26.5, ageSd: 3.2 },
  C: { mean: 71.9, sd: 6.4, age: 27.2, ageSd: 3.3 },
  EDGE: { mean: 72.9, sd: 7.8, age: 26.6, ageSd: 3.1 },
  DT: { mean: 72.0, sd: 6.7, age: 27.0, ageSd: 3.1 },
  ILB: { mean: 71.0, sd: 6.5, age: 26.6, ageSd: 3.0 },
  OLB: { mean: 71.0, sd: 6.5, age: 26.6, ageSd: 3.0 },
  CB: { mean: 70.7, sd: 7.5, age: 26.0, ageSd: 2.7 },
  S: { mean: 72.2, sd: 5.9, age: 26.5, ageSd: 3.0 },
  K: { mean: 79.2, sd: 6.5, age: 28.8, ageSd: 4.0 },
  P: { mean: 78.8, sd: 5.2, age: 29.4, ageSd: 4.0 },
};

export type GroupId = "passing" | "receivers" | "line" | "backfield" | "front" | "secondary" | "specialists";
export const GROUP_OF: Readonly<Record<Position, GroupId>> = {
  QB: "passing", WR: "receivers", TE: "receivers", OT: "line", OG: "line", C: "line", RB: "backfield",
  EDGE: "front", DT: "front", ILB: "front", OLB: "front", CB: "secondary", S: "secondary", K: "specialists", P: "specialists",
};

export interface PositionDna {
  /** rating points added to the position's mean */
  shift: number;
  /** multiplier on its spread */
  spread: number;
  /** how heavy its elite tail is (1 = the reference league) */
  tail: number;
  /** multiplier on how many bodies the position has beyond roster demand */
  depth: number;
  /** relative frequency of each archetype, by id */
  archetypes: Record<string, number>;
}

export interface LeagueDna {
  version: number;
  dnaSeed: number;
  /** overall talent: points added everywhere */
  level: number;
  /** the whole league's elite-tail multiplier */
  tail: number;
  /** years added to every age */
  ageTilt: number;
  /** multiplier on developmental room */
  upside: number;
  positions: Record<Position, PositionDna>;
}

/** Every tunable range in one place; the pool-variance experiment moves these. */
export const TUNING = {
  levelSd: 0.9,
  groupShiftSd: 2.6,
  shiftLimit: 5,
  spreadSd: 0.1,
  tailSd: 0.22,
  tailLimit: [0.6, 1.7] as const,
  depthRange: [1.12, 1.3] as const,
  ageTiltSd: 0.5,
  upsideSd: 0.15,
  archSd: 0.55,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Points per team-game moved by one rating point of league-wide talent at a
 * position (fitted over 140 generated leagues on the real engine; offence
 * raises scoring, defence lowers it). A league deep everywhere on offence and
 * thin on defence played 30+ points a game and the reverse 17, far outside any
 * NFL era (about 20.5-25). Keeping a league's *net* scoring pull inside
 * `SCORING_LIMIT` keeps the football believable while leaving which positions
 * are deep or thin free: it moves talent between sides of the ball, it does
 * not hand any team anything.
 */
export const SCORING_WEIGHT: Partial<Record<Position, number>> = {
  QB: 0.4, WR: 0.16, TE: 0.1, RB: 0.13, OT: 0.25, OG: 0.22, C: 0.23,
  EDGE: -0.2, DT: -0.29, ILB: -0.3, CB: -0.2, S: -0.3,
};
export const SCORING_LIMIT = 1.0;
/**
 * Where the net pull is centred: a league with no character plays about 0.9 points a game above the validated engine
 * (24.3 against 23.5 on the real rosters, 100 games x 10 leagues), so leagues are centred that far below neutral.
 */
export const SCORING_CENTRE = -0.9;

/** Move position shifts, minimally, until their net scoring pull is within the limit. */
export function neutralizeScoring(shifts: Record<Position, number>): void {
  let effect = 0;
  let norm = 0;
  for (const [pos, w] of Object.entries(SCORING_WEIGHT) as [Position, number][]) {
    effect += w * shifts[pos];
    norm += w * w;
  }
  const off = effect - SCORING_CENTRE;
  if (Math.abs(off) <= SCORING_LIMIT) return;
  const excess = off - Math.sign(off) * SCORING_LIMIT;
  for (const [pos, w] of Object.entries(SCORING_WEIGHT) as [Position, number][]) {
    shifts[pos] = clamp(shifts[pos] - (w * excess) / norm, -TUNING.shiftLimit, TUNING.shiftLimit);
  }
}

const NEUTRAL_POS = (pos: Position): PositionDna => ({
  shift: 0,
  spread: 1,
  tail: 1,
  depth: 1.2,
  archetypes: Object.fromEntries((ARCHETYPES_BY_POSITION[pos] ?? []).map((a) => [a.id, 1])),
});

/** A league with no character at all: the reference shape. Used for targets and tests. */
export function neutralDna(): LeagueDna {
  return {
    version: GEN_VERSION,
    dnaSeed: 0,
    level: 0,
    tail: 1,
    ageTilt: 0,
    upside: 1,
    positions: Object.fromEntries(POSITIONS.map((p) => [p, NEUTRAL_POS(p)])) as Record<Position, PositionDna>,
  };
}

/**
 * Draw a league's character from its DNA seed.
 *
 * Correlated, not independent: an offence factor and a defence factor sit
 * under the groups, so a deep quarterback class usually (not always) comes
 * with good receivers and a weak line is likelier next to a strong front.
 * Each position then gets its own wobble on top.
 */
export function drawLeagueDna(dnaSeed: number): LeagueDna {
  const r = stream(dnaSeed, "league");
  const off = r.normal();
  const def = r.normal();
  const g = (own: number, ofOff: number, ofDef: number) => ofOff * off + ofDef * def + own * r.normal();
  const group: Record<string, number> = {
    passing: g(0.8, 0.6, 0),
    receivers: g(0.75, 0.55, 0) + 0.35 * 0,
    line: g(0.85, 0.35, 0),
    backfield: g(0.9, 0.25, 0),
    front: g(0.8, 0, 0.55),
    secondary: g(0.8, 0, 0.5),
    specialists: g(1, 0, 0),
  };
  // QB and receivers share a passing-game factor
  group.receivers = 0.5 * group.passing! + 0.85 * group.receivers!;
  const level = clamp(r.normal(0, TUNING.levelSd), -2, 2);
  const tail = clamp(Math.exp(r.normal(0, TUNING.tailSd)), TUNING.tailLimit[0], TUNING.tailLimit[1]);
  const ageTilt = clamp(r.normal(0, TUNING.ageTiltSd), -1, 1);
  const upside = clamp(Math.exp(r.normal(0, TUNING.upsideSd)), 0.75, 1.35);
  const positions = {} as Record<Position, PositionDna>;
  for (const pos of POSITIONS) {
    const pr = stream(dnaSeed, "pos", pos);
    const grp = group[GROUP_OF[pos]] ?? 0;
    const archetypes: Record<string, number> = {};
    for (const a of ARCHETYPES_BY_POSITION[pos] ?? []) archetypes[a.id] = Math.exp(pr.normal(0, TUNING.archSd));
    positions[pos] = {
      shift: clamp(TUNING.groupShiftSd * grp * 0.8 + pr.normal(0, 1.1), -TUNING.shiftLimit, TUNING.shiftLimit),
      spread: clamp(Math.exp(pr.normal(0, TUNING.spreadSd)), 0.8, 1.25),
      tail: clamp(Math.exp(pr.normal(0, TUNING.tailSd)), TUNING.tailLimit[0], TUNING.tailLimit[1]),
      depth: TUNING.depthRange[0] + pr.float(0, 1) * (TUNING.depthRange[1] - TUNING.depthRange[0]),
      archetypes,
    };
  }
  const shifts = Object.fromEntries(POSITIONS.map((p) => [p, positions[p].shift])) as Record<Position, number>;
  neutralizeScoring(shifts);
  for (const pos of POSITIONS) positions[pos].shift = shifts[pos];
  return { version: GEN_VERSION, dnaSeed, level, tail, ageTilt, upside, positions };
}
