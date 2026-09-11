import type { Position } from "@/domain";

/**
 * Real historical NFL draft composition, 2018-2026 (Pro-Football-Reference's
 * per-year draft listings — 9 drafts, 1,961 picks total). The user supplied
 * these as PDFs; they had no text layer (print-to-PDF rasterizations), so
 * they were OCR'd (Tesseract, word-bounding-box row reconstruction to avoid
 * mis-reading the wide stat table as multiple columns) and parsed into
 * per-pick {round, pick, team, position, age, college} records.
 *
 * PFR's own position-column granularity is inconsistent across years: some
 * years split O-line into OT/OG/C, D-line into EDGE/DT, linebacker into
 * ILB/OLB, and defensive back into CB/S; other years (notably 2021, and part
 * of 2022) only give the broad group (OL/DL/LB/DB). Rather than drop those
 * rows or guess, each broad-group pick was split *fractionally* across its
 * specific members using the empirical ratio from the years that do give the
 * specific position — see `BROAD_GROUP_SPLIT` below. Sample sizes for those
 * ratios vary a lot: the OT/OG/C split rests on 186 specific-coded picks and
 * the CB/S split on 274, both solid; the ILB/OLB split rests on only 31
 * specific-coded picks (most LB-position years use the broad code), so that
 * one split is the least certain of the four.
 *
 * `POSITION_BY_ROUND` and `AGE_BY_POSITION` below are the resulting
 * probability tables, used by `generateDraftClass` in place of the previous
 * flat, round-agnostic position weighting.
 */

export const BROAD_GROUP_SPLIT = {
  OL: { OT: 0.554, OG: 0.28, C: 0.167 }, // n=186 specific-coded picks
  DL: { EDGE: 0.567, DT: 0.433 }, // n=298
  LB: { ILB: 0.226, OLB: 0.774 }, // n=31 — thin sample, least certain split
  DB: { CB: 0.657, S: 0.343 }, // n=274
} as const;

/** position -> probability, one distribution per round (1-7). */
export const POSITION_BY_ROUND: Record<number, Record<Position, number>> = {
  1: {
    QB: 0.1107, RB: 0.048, WR: 0.1439, TE: 0.0295, OT: 0.1404, OG: 0.0521, C: 0.0289,
    EDGE: 0.1211, DT: 0.0893, ILB: 0.0277, OLB: 0.0645, CB: 0.1017, S: 0.0422, K: 0, P: 0,
  },
  2: {
    QB: 0.0166, RB: 0.0581, WR: 0.1494, TE: 0.0705, OT: 0.0962, OG: 0.038, C: 0.0401,
    EDGE: 0.1237, DT: 0.0755, ILB: 0.0159, OLB: 0.0795, CB: 0.1542, S: 0.0823, K: 0, P: 0,
  },
  3: {
    QB: 0.0411, RB: 0.0685, WR: 0.1336, TE: 0.0788, OT: 0.1117, OG: 0.0493, C: 0.0308,
    EDGE: 0.1129, DT: 0.0789, ILB: 0.0274, OLB: 0.0959, CB: 0.1046, S: 0.0632, K: 0.0034, P: 0,
  },
  4: {
    QB: 0.0327, RB: 0.1091, WR: 0.1236, TE: 0.0727, OT: 0.0779, OG: 0.0682, C: 0.0248,
    EDGE: 0.0981, DT: 0.0765, ILB: 0.0197, OLB: 0.0785, CB: 0.1341, S: 0.0622, K: 0.0073, P: 0.0145,
  },
  5: {
    QB: 0.0385, RB: 0.0909, WR: 0.0909, TE: 0.0769, OT: 0.0558, OG: 0.0421, C: 0.035,
    EDGE: 0.1008, DT: 0.074, ILB: 0.0311, OLB: 0.1052, CB: 0.152, S: 0.0752, K: 0.0175, P: 0.014,
  },
  6: {
    QB: 0.0397, RB: 0.0861, WR: 0.1689, TE: 0.0364, OT: 0.1271, OG: 0.0572, C: 0.021,
    EDGE: 0.0755, DT: 0.0867, ILB: 0.0242, OLB: 0.0718, CB: 0.1099, S: 0.0623, K: 0.0232, P: 0.0099,
  },
  7: {
    QB: 0.0544, RB: 0.0952, WR: 0.1088, TE: 0.0578, OT: 0.0936, OG: 0.047, C: 0.0329,
    EDGE: 0.1, DT: 0.0735, ILB: 0.0226, OLB: 0.0862, CB: 0.1298, S: 0.0743, K: 0.0068, P: 0.017,
  },
};

/** Draft-day age by position (mean/stdev in years), same 9-draft sample. */
export const AGE_BY_POSITION: Record<Position, { mean: number; stdev: number }> = {
  QB: { mean: 22.85, stdev: 1.12 },
  RB: { mean: 22.15, stdev: 0.93 },
  WR: { mean: 22.26, stdev: 0.91 },
  TE: { mean: 22.62, stdev: 1.01 },
  OT: { mean: 22.6, stdev: 1.01 },
  OG: { mean: 22.71, stdev: 0.94 },
  C: { mean: 22.49, stdev: 0.95 },
  EDGE: { mean: 22.46, stdev: 0.96 },
  DT: { mean: 22.62, stdev: 0.99 },
  ILB: { mean: 22.37, stdev: 1.0 },
  OLB: { mean: 22.45, stdev: 1.0 },
  CB: { mean: 22.33, stdev: 1.0 },
  S: { mean: 22.37, stdev: 0.95 },
  K: { mean: 22.71, stdev: 1.13 },
  P: { mean: 23.19, stdev: 1.47 },
};
