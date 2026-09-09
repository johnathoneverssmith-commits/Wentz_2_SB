/**
 * §6 centralized data-cleaning filters + §6.6 missingness helpers.
 * Every analysis script must import these rather than re-deriving ad hoc filters.
 */

import type { PbpRow } from "./pbp.js";

const truthy = (v: unknown): boolean => v === 1 || v === true || v === 1n;

/** §6.1 core row exclusions — not an actual offensive snap / unusable row. */
export function passesCoreExclusions(r: PbpRow): boolean {
  if (!passesAdminExclusions(r)) return false;
  if (r.down == null) return false;
  if (r.yardline_100 == null) return false;
  return true;
}

/**
 * The subset of §6.1 that still applies to administrative plays (kickoffs,
 * extra points, two-point tries) — these legitimately have `down == null`
 * and no `yardline_100`, so models whose population is such a play use this
 * instead of the full core filter.
 */
export function passesAdminExclusions(r: PbpRow): boolean {
  if (truthy(r.play_deleted)) return false;
  if (truthy(r.aborted_play)) return false;
  if (r.play_type === "no_play") return false;
  if (r.posteam == null || r.posteam === "") return false;
  return true;
}

/** §6.5 production baseline population. */
export function inProductionBaseline(r: PbpRow): boolean {
  return r.season_type === "REG";
}

/** §6.2 physical-outcome models fit on penalty-free plays only. */
export function isPenaltyFree(r: PbpRow): boolean {
  return !truthy(r.penalty);
}

/** §6.3 — kneels/spikes are never ordinary run/pass plays. */
export function isKneelOrSpike(r: PbpRow): boolean {
  return truthy(r.qb_kneel) || truthy(r.qb_spike);
}

/**
 * §6.6 applicable-population denominators. `null` => the full cleaned play
 * population is the denominator for that field.
 */
export const APPLICABLE_POPULATION: Record<string, (r: PbpRow) => boolean> = {
  run_gap: (r) => r.play_type === "run",
  run_location: (r) => r.play_type === "run",
  air_yards: (r) => r.play_type === "pass",
  pass_length: (r) => r.play_type === "pass",
  pass_location: (r) => r.play_type === "pass",
  cp: (r) => r.play_type === "pass",
  cpoe: (r) => r.play_type === "pass",
  xyac_mean_yardage: (r) => r.play_type === "pass" && truthy(r.complete_pass),
  xyac_median_yardage: (r) => r.play_type === "pass" && truthy(r.complete_pass),
  xyac_success: (r) => r.play_type === "pass" && truthy(r.complete_pass),
  xyac_fd: (r) => r.play_type === "pass" && truthy(r.complete_pass),
  yards_after_catch: (r) => truthy(r.complete_pass),
  kick_distance: (r) => r.play_type === "field_goal",
  field_goal_result: (r) => r.play_type === "field_goal",
  penalty_type: (r) => truthy(r.penalty),
  penalty_yards: (r) => truthy(r.penalty),
};

/** A value that "counts as missing" for a categorical/string column (§6.6). */
export function isEmptySentinel(v: unknown): boolean {
  return typeof v === "string" && v.trim() === "";
}

export function isNullish(v: unknown): boolean {
  return v == null || (typeof v === "number" && Number.isNaN(v));
}

export interface MissingnessRow {
  field: string;
  rawNull: number;
  rawEmpty: number;
  rawDenominator: number;
  rawMissingPct: number;
  applicableNull: number;
  applicableEmpty: number;
  applicableDenominator: number;
  applicableMissingPct: number;
  denominatorRule: string;
}

/** Compute both raw and applicable-population missingness for one field (§6.6). */
export function missingnessFor(rows: PbpRow[], field: string): MissingnessRow {
  const appFn = APPLICABLE_POPULATION[field];
  let rawNull = 0;
  let rawEmpty = 0;
  let appNull = 0;
  let appEmpty = 0;
  let appDenom = 0;
  for (const r of rows) {
    const v = r[field];
    const nul = isNullish(v);
    const emp = isEmptySentinel(v);
    if (nul) rawNull++;
    if (emp) rawEmpty++;
    if (appFn) {
      if (!appFn(r)) continue;
      appDenom++;
      if (nul) appNull++;
      if (emp) appEmpty++;
    }
  }
  const rawDenom = rows.length;
  if (!appFn) {
    appDenom = rawDenom;
    appNull = rawNull;
    appEmpty = rawEmpty;
  }
  return {
    field,
    rawNull,
    rawEmpty,
    rawDenominator: rawDenom,
    rawMissingPct: rawDenom ? (100 * (rawNull + rawEmpty)) / rawDenom : 0,
    applicableNull: appNull,
    applicableEmpty: appEmpty,
    applicableDenominator: appDenom,
    applicableMissingPct: appDenom ? (100 * (appNull + appEmpty)) / appDenom : 0,
    denominatorRule: appFn ? applicableRuleText(field) : "full cleaned play population",
  };
}

function applicableRuleText(field: string): string {
  const map: Record<string, string> = {
    run_gap: 'play_type == "run"',
    run_location: 'play_type == "run"',
    air_yards: 'play_type == "pass"',
    pass_length: 'play_type == "pass"',
    pass_location: 'play_type == "pass"',
    cp: 'play_type == "pass"',
    cpoe: 'play_type == "pass"',
    xyac_mean_yardage: 'pass & complete_pass == 1',
    xyac_median_yardage: 'pass & complete_pass == 1',
    xyac_success: 'pass & complete_pass == 1',
    xyac_fd: 'pass & complete_pass == 1',
    yards_after_catch: "complete_pass == 1",
    kick_distance: 'play_type == "field_goal"',
    field_goal_result: 'play_type == "field_goal"',
    penalty_type: "penalty == 1",
    penalty_yards: "penalty == 1",
  };
  return map[field] ?? "full cleaned play population";
}
