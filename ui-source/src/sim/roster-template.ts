import type { Position } from "@/domain";

/** How many players of each position the mock generator puts on a roster. */
export const ROSTER_TEMPLATE: Array<{ pos: Position; count: number; starters: number }> = [
  { pos: "QB", count: 3, starters: 1 },
  { pos: "RB", count: 4, starters: 1 },
  { pos: "WR", count: 6, starters: 3 },
  { pos: "TE", count: 3, starters: 1 },
  { pos: "OT", count: 4, starters: 2 },
  { pos: "OG", count: 4, starters: 2 },
  { pos: "C", count: 2, starters: 1 },
  { pos: "EDGE", count: 4, starters: 2 },
  { pos: "DT", count: 4, starters: 2 },
  { pos: "ILB", count: 4, starters: 2 },
  { pos: "OLB", count: 2, starters: 0 },
  { pos: "CB", count: 5, starters: 2 },
  { pos: "S", count: 4, starters: 2 },
  { pos: "K", count: 1, starters: 1 },
  { pos: "P", count: 1, starters: 1 },
];

export const ROSTER_SIZE = ROSTER_TEMPLATE.reduce((n, r) => n + r.count, 0); // 53

/** Rough position-prior overall (mean) the generator centres ratings on. */
export const POSITION_PRIOR: Record<Position, number> = {
  QB: 74, RB: 72, WR: 73, TE: 71, OT: 73, OG: 72, C: 72,
  EDGE: 74, DT: 73, ILB: 72, OLB: 70, CB: 73, S: 72, K: 70, P: 68,
};

/**
 * Position-typical retirement age (spec §6.3 input to retirement odds) — the
 * age at which a *veteran who has already stuck on a roster* typically hangs
 * it up, not the average career length across all drafted players (which is
 * much lower, ~3-4 years, because it's dominated by players who never make
 * it past a rookie deal — a different population than "is this rostered
 * player retiring").
 *
 * Cross-checked against relative position longevity from recent (2023-2025)
 * aging-curve research (PFF/4for4/ESPN fantasy analytics; draftchallenger.com's
 * ~11k-player final-season-age study) and real recent (2010s-2020s) veteran
 * retirements at each position (Brady/Rivers/Roethlisberger at QB;
 * Fitzgerald/A.Brown-era WR1s; J.Peters/Jason-Witten-tier O-line; Von
 * Miller/Cam Jordan-tier EDGE; Vinatieri/Dawson-tier K). WR nudged 33→34:
 * multiple recent (2023-2025) studies find receiver decline now starts
 * later (~age 30) and receivers sustain value into their early 30s more
 * than earlier-era data suggested — consistent with player emphasis that
 * recent medical/rules-era data should outweigh older figures here. See
 * `injuryAgeReduction` in MockSimulationService.ts for how a player's own
 * injury history further lowers their *effective* norm below this baseline.
 */
export const RETIREMENT_AGE: Record<Position, number> = {
  QB: 39, RB: 30, WR: 34, TE: 34, OT: 35, OG: 35, C: 36,
  EDGE: 34, DT: 34, ILB: 33, OLB: 33, CB: 33, S: 34, K: 42, P: 42,
};
