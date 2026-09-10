/**
 * Coaching staff model (spec §16) — a small set of quality ratings plus explicit
 * tendency knobs for the head coach and the two coordinators.
 *
 * These feed `staff-shift.ts`, which nudges the same resolver logits/means the
 * player rating layer touches. Effects are deliberately subtle: a best-vs-worst
 * full staff is worth roughly 3–4 points per team-game, so individual games
 * barely move and the §22 validation is unaffected. When no staff is supplied
 * the shift is exactly zero (the rating-parity path).
 *
 * v0 values are authored (`staff-data.ts`) on a compressed 35–70 scale and are
 * expected to be tuned.
 */

export type OffScheme =
  | "west_coast"
  | "vertical"
  | "spread"
  | "power_run"
  | "zone_run"
  | "pro_style";

export type DefScheme =
  | "four_three"
  | "three_four"
  | "multiple"
  | "cover_3"
  | "cover_2"
  | "man_press";

export interface HeadCoach {
  name: string;
  /** 1–99. Situational decisions: 4th downs, timeouts, two-point/challenge calls. */
  gameManagement: number;
  /** 1–99. Team discipline → fewer pre-snap and live-ball penalties. */
  discipline: number;
  /** −1..+1 relative to the league-average 4th-down go rate. */
  aggression: number;
}

export interface OffensiveCoordinator {
  name: string;
  /** 1–99. Scheme design + in-game adjustments → offensive efficiency. */
  rating: number;
  scheme: OffScheme;
  /** −1..+1 pass rate over expectation (texture; v0.1 wires this to M02). */
  passBias: number;
  /** −1..+1 snap tempo (positive = faster / more no-huddle). */
  tempo: number;
}

export interface DefensiveCoordinator {
  name: string;
  /** 1–99. Scheme design + in-game adjustments → efficiency allowed. */
  rating: number;
  scheme: DefScheme;
  /** −1..+1 blitz rate over the league average. */
  blitzBias: number;
}

export interface Staff {
  headCoach: HeadCoach;
  oc: OffensiveCoordinator;
  dc: DefensiveCoordinator;
}

/** A perfectly neutral staff — every shift it produces is zero. */
export function leagueAverageStaff(label = "League Average"): Staff {
  return {
    headCoach: { name: `${label} HC`, gameManagement: 50, discipline: 50, aggression: 0 },
    oc: { name: `${label} OC`, rating: 50, scheme: "pro_style", passBias: 0, tempo: 0 },
    dc: { name: `${label} DC`, rating: 50, scheme: "multiple", blitzBias: 0 },
  };
}

/** Map a 1–99 rating to roughly [-1, +1] (50 → 0), clipped. */
export function ratingNorm(rating: number): number {
  return Math.max(-1, Math.min(1, (rating - 50) / 40));
}

/** scheme_tag values that a coordinator's scheme is a good fit for. */
export const OFF_SCHEME_TAGS: Record<OffScheme, readonly string[]> = {
  west_coast: ["west_coast", "play_action", "move_te", "zone_run", "outside_zone"],
  vertical: ["vertical", "spread", "play_action", "downhill"],
  spread: ["spread", "rpo", "zone_run", "outside_zone", "west_coast"],
  power_run: ["power_run", "gap_scheme", "inline", "downhill", "pass_pro"],
  zone_run: ["zone_run", "outside_zone", "west_coast", "move_te"],
  pro_style: ["play_action", "inline", "move_te", "power_run", "west_coast"],
};

export const DEF_SCHEME_TAGS: Record<DefScheme, readonly string[]> = {
  four_three: ["base_4_3", "one_gap", "penetrate", "attack", "wide_9"],
  three_four: ["base_3_4", "two_gap", "contain", "nose"],
  multiple: ["nickel", "cover_3", "split_safety", "robber", "move_te"],
  cover_3: ["cover_3", "single_high", "zone", "robber"],
  cover_2: ["cover_2", "split_safety", "zone"],
  man_press: ["man_press", "cover_man", "cover_1", "nickel"],
};

/**
 * Fraction of `tagLists` (one per player in a unit) that overlap `schemeTags`.
 * The league-neutral baseline is ~0.4; `staff-shift` centres on that.
 */
export function schemeFitFraction(
  tagLists: readonly (readonly string[] | undefined)[],
  schemeTags: readonly string[],
): number {
  const want = new Set(schemeTags);
  let fit = 0;
  let n = 0;
  for (const tags of tagLists) {
    if (!tags || tags.length === 0) continue;
    n += 1;
    if (tags.some((t) => want.has(t))) fit += 1;
  }
  return n ? fit / n : 0;
}
