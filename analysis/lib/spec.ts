/**
 * Machine-readable pieces of NFL_SIM_EMPIRICAL_MODELING_SPEC.md
 * (mirrored in docs/engine_spec.md). Only the parts the §28 audit needs.
 */

/** §1.1 — fields the spec's schema reference lists as expected. Wildcards expanded. */
export const SPEC_REQUIRED_FIELDS: readonly string[] = [
  "play_id", "game_id", "home_team", "away_team", "season_type", "week", "posteam", "defteam",
  "yardline_100", "quarter_seconds_remaining", "half_seconds_remaining", "game_seconds_remaining",
  "qtr", "down", "goal_to_go", "ydstogo", "play_type", "yards_gained", "shotgun", "no_huddle",
  "qb_dropback", "qb_kneel", "qb_spike", "qb_scramble", "pass_length", "pass_location", "air_yards",
  "yards_after_catch", "run_location", "run_gap", "field_goal_result", "kick_distance",
  "posteam_timeouts_remaining", "defteam_timeouts_remaining", "score_differential", "interception",
  "fumble_lost", "qb_hit", "rush_attempt", "pass_attempt", "sack", "touchdown", "pass_touchdown",
  "rush_touchdown", "field_goal_attempt", "kickoff_attempt", "punt_attempt", "fumble",
  "complete_pass", "passer_player_id", "receiver_player_id", "rusher_player_id",
  "interception_player_id", "sack_player_id", "half_sack_1_player_id", "half_sack_2_player_id",
  "kicker_player_id", "punter_player_id", "return_yards", "penalty", "penalty_type", "penalty_yards",
  "season", "cp", "cpoe", "roof", "surface", "temp", "wind", "home_coach", "away_coach",
  "out_of_bounds", "xyac_mean_yardage", "xyac_median_yardage", "xyac_success", "xyac_fd", "xpass",
  "pass_oe",
  // wildcard groups in the spec ("qb_hit_1_player_id", "assist_tackle_*_player_id", ...)
  "qb_hit_1_player_id", "qb_hit_2_player_id",
  "solo_tackle_1_player_id", "solo_tackle_2_player_id",
  "assist_tackle_1_player_id", "assist_tackle_2_player_id", "assist_tackle_3_player_id", "assist_tackle_4_player_id",
  "pass_defense_1_player_id", "pass_defense_2_player_id",
  "forced_fumble_player_1_player_id", "forced_fumble_player_2_player_id",
];

/** §5 — universal pre-snap STATE variables. */
export const STATE_FIELDS = new Set([
  "season", "season_type", "week", "game_id", "play_id", "posteam", "defteam", "posteam_type",
  "qtr", "quarter_seconds_remaining", "half_seconds_remaining", "game_seconds_remaining",
  "down", "ydstogo", "yardline_100", "goal_to_go", "score_differential",
  "posteam_timeouts_remaining", "defteam_timeouts_remaining",
  // environment (§17)
  "roof", "surface", "temp", "wind", "weather", "stadium", "stadium_id",
  "home_team", "away_team", "home_coach", "away_coach", "game_date", "start_time", "div_game",
]);

/** §9 — benchmark/validation only, never auto-fed into a fitted model. */
export const BENCHMARK_ONLY_FIELDS = new Set([
  "xpass", "pass_oe", "cp", "cpoe",
  "xyac_mean_yardage", "xyac_median_yardage", "xyac_success", "xyac_fd", "xyac_epa",
]);

/** §10 — downstream / outcome-derived / market: never a core outcome predictor. */
export const LEAKAGE_FIELDS = new Set([
  "posteam_score_post", "defteam_score_post", "score_differential_post",
  "epa", "air_epa", "yac_epa", "qb_epa", "comp_air_epa", "comp_yac_epa", "total_home_epa",
  "total_away_epa", "wpa", "wp", "def_wp", "home_wp", "away_wp", "vegas_wp", "vegas_home_wp",
  "vegas_wpa", "vegas_home_wpa", "ep",
  "success", "series_success", "series_result",
  "first_down_rush", "first_down_pass", "first_down_penalty",
  "third_down_converted", "third_down_failed", "fourth_down_converted", "fourth_down_failed",
  "drive_ended_with_score", "fixed_drive_result", "fixed_drive",
  "spread_line", "total_line", "result", "total",
]);

/** §19 valid classification tags. */
export type Classification =
  | "STATE"
  | "INTERMEDIATE"
  | "TARGET"
  | "IDENTIFIER_GROUPING"
  | "BENCHMARK_ONLY"
  | "VALIDATION_ONLY"
  | "LEAKAGE_DO_NOT_USE"
  | "IGNORE_V1";

/** Fields that are a model TARGET somewhere but INTERMEDIATE/STATE downstream (§19). */
const TARGET_FIELDS = new Set([
  "yards_gained", "yards_after_catch", "air_yards", "complete_pass", "interception", "qb_hit",
  "pass_location", "run_location", "run_gap", "shotgun", "qb_dropback", "qb_scramble", "sack",
  "fumble", "fumble_lost", "field_goal_result", "extra_point_result", "kick_distance",
  "return_yards", "touchback", "two_point_conv_result",
]);

/** Snap-mechanics flags simulated within a play; usable downstream, never as an upstream predictor. */
const INTERMEDIATE_FIELDS = new Set([
  "pass_attempt", "rush_attempt", "pass_length", "pass_location", "no_huddle", "shotgun",
  "qb_hit", "air_yards", "field_goal_attempt", "punt_attempt", "kickoff_attempt",
  "extra_point_attempt", "two_point_attempt", "qb_kneel", "qb_spike", "aborted_play",
  "first_down", "pass_touchdown", "rush_touchdown", "return_touchdown", "safety", "touchdown",
]);

const VALIDATION_ONLY_FIELDS = new Set([
  "desc", "fumbled_1_player_id", "fumbled_2_player_id", "fumble_recovery_1_player_id",
  "fumble_recovery_2_player_id", "forced_fumble_player_1_player_id", "forced_fumble_player_2_player_id",
  "tackle_for_loss_1_player_id", "tackle_for_loss_2_player_id",
]);

/** §25 — deferred to the V1.5 penalty module, but genuine targets there (not IGNORE_V1). */
const PENALTY_V1_5_FIELDS = new Set(["penalty", "penalty_type", "penalty_yards", "penalty_team"]);

/**
 * Rule-based classifier for §19's `variable_classification.csv`.
 * Explicit spec lists win; the rest fall through to pattern rules, then IGNORE_V1
 * with a note so a human can promote them when a model needs them.
 */
export function classify(col: string): { classification: Classification; note: string } {
  if (LEAKAGE_FIELDS.has(col)) return { classification: "LEAKAGE_DO_NOT_USE", note: "spec §10 explicit" };
  if (BENCHMARK_ONLY_FIELDS.has(col)) return { classification: "BENCHMARK_ONLY", note: "spec §9 explicit" };
  if (STATE_FIELDS.has(col)) return { classification: "STATE", note: "spec §5/§17" };
  if (VALIDATION_ONLY_FIELDS.has(col)) return { classification: "VALIDATION_ONLY", note: "attribution/debug only" };
  if (TARGET_FIELDS.has(col)) {
    return {
      classification: "TARGET",
      note: INTERMEDIATE_FIELDS.has(col)
        ? "TARGET in its own model; INTERMEDIATE downstream (§19)"
        : "model target (§19)",
    };
  }
  if (INTERMEDIATE_FIELDS.has(col)) return { classification: "INTERMEDIATE", note: "simulated mid-play; not an upstream predictor" };
  if (PENALTY_V1_5_FIELDS.has(col)) {
    return {
      classification: col === "penalty" ? "INTERMEDIATE" : "TARGET",
      note: "V1.5 penalty module (§25); not fitted or used in V1 core outcomes",
    };
  }

  // pattern rules
  if (/_post$/.test(col)) return { classification: "LEAKAGE_DO_NOT_USE", note: "post-play state (§10)" };
  if (/(^|_)epa$|(^|_)wpa?$|^ep$|vegas_/.test(col)) return { classification: "LEAKAGE_DO_NOT_USE", note: "EPA/WP/market family (§10)" };
  if (/^xyac_|^cpoe?$|^xpass$|^pass_oe$|^x[a-z]+_/.test(col)) return { classification: "BENCHMARK_ONLY", note: "nflverse expected-value model output (§9)" };
  if (/_player_id$|_player_name$|^(passer|rusher|receiver|kicker|punter)_|_coach$/.test(col)) {
    return { classification: "IDENTIFIER_GROUPING", note: "grouping / stat-credit only, not a portable feature (§11)" };
  }
  if (/_team$|^(home|away)_/.test(col)) return { classification: "IDENTIFIER_GROUPING", note: "team identity — grouping only (§16)" };
  if (/^drive_|^fixed_drive|_drive$/.test(col)) return { classification: "LEAKAGE_DO_NOT_USE", note: "drive-aggregate — encodes future plays" };

  return { classification: "IGNORE_V1", note: "not referenced in spec V1; classify when a model needs it" };
}

/** §11 model population predicates — for Q4 "clean plays remaining per model". */
export interface ModelPopulation {
  id: string;
  name: string;
  /** applied AFTER the base exclusions + (unless noted) §6.2 penalty-free */
  predicate: (r: Record<string, unknown>) => boolean;
  penaltyFree: boolean;
  /**
   * "core" (default) = full §6.1 filter (needs a real down/yardline).
   * "admin" = §6.1 minus the down/yardline checks — for kickoffs / XP / 2pt,
   *   which legitimately have `down == null` (see §28.2).
   */
  base?: "core" | "admin";
}

const is1 = (v: unknown): boolean => v === 1 || v === true || v === 1n;
const is0 = (v: unknown): boolean => v === 0 || v === false || v === 0n || v == null;

export const MODEL_POPULATIONS: readonly ModelPopulation[] = [
  { id: "M01", name: "Fourth-down action", penaltyFree: false,
    predicate: (r) => r.down === 4 && is0(r.qb_kneel) && is0(r.qb_spike) },
  { id: "M02", name: "Play call: dropback vs designed run", penaltyFree: false,
    predicate: (r) => is0(r.qb_kneel) && is0(r.qb_spike) && !is1(r.field_goal_attempt) &&
      !is1(r.punt_attempt) && !is1(r.kickoff_attempt) && !is1(r.extra_point_attempt) &&
      (is1(r.qb_dropback) || (is1(r.rush_attempt) && is0(r.qb_scramble))) },
  { id: "M03", name: "Shotgun formation", penaltyFree: false,
    predicate: (r) => is1(r.qb_dropback) || (is1(r.rush_attempt) && is0(r.qb_scramble)) },
  { id: "M04", name: "Dropback terminal action", penaltyFree: true,
    predicate: (r) => is1(r.qb_dropback) && is0(r.qb_kneel) && is0(r.qb_spike) },
  { id: "M05", name: "Pass target depth", penaltyFree: true,
    predicate: (r) => is1(r.pass_attempt) && is0(r.sack) && is0(r.qb_spike) && r.air_yards != null },
  { id: "M06", name: "Pass location", penaltyFree: true,
    predicate: (r) => is1(r.pass_attempt) && is0(r.sack) && is0(r.qb_spike) && r.pass_location != null },
  { id: "M07", name: "Target-player selection", penaltyFree: true,
    predicate: (r) => is1(r.pass_attempt) && is0(r.sack) && is0(r.qb_spike) && r.receiver_player_id != null },
  { id: "M08", name: "QB hit on thrown pass", penaltyFree: true,
    predicate: (r) => is1(r.pass_attempt) && is0(r.sack) && is0(r.qb_spike) },
  { id: "M09", name: "Pass result (comp/int/incomplete)", penaltyFree: true,
    predicate: (r) => is1(r.pass_attempt) && is0(r.sack) && is0(r.qb_spike) },
  { id: "M10", name: "Yards after catch", penaltyFree: true,
    predicate: (r) => is1(r.complete_pass) && r.yards_after_catch != null },
  { id: "M11", name: "Scramble yardage", penaltyFree: true,
    predicate: (r) => is1(r.qb_scramble) },
  { id: "M12", name: "Runner selection / designed carry", penaltyFree: false,
    predicate: (r) => is1(r.rush_attempt) && is0(r.qb_scramble) && is0(r.qb_kneel) },
  { id: "M13", name: "Run location / gap", penaltyFree: false,
    predicate: (r) => is1(r.rush_attempt) && is0(r.qb_scramble) && is0(r.qb_kneel) },
  { id: "M14", name: "Designed rushing yardage", penaltyFree: true,
    predicate: (r) => is1(r.rush_attempt) && is0(r.qb_scramble) && is0(r.qb_kneel) },
  { id: "M17", name: "Sack yardage", penaltyFree: true,
    predicate: (r) => is1(r.sack) },
  { id: "M20", name: "Field-goal success", penaltyFree: false,
    predicate: (r) => is1(r.field_goal_attempt) && r.field_goal_result != null },
  { id: "M21", name: "Punt outcome", penaltyFree: false,
    predicate: (r) => is1(r.punt_attempt) },
  { id: "M22", name: "Kickoff outcome (2024+ regime)", penaltyFree: false, base: "admin",
    predicate: (r) => is1(r.kickoff_attempt) },
  { id: "M23", name: "Extra point", penaltyFree: false, base: "admin",
    predicate: (r) => is1(r.extra_point_attempt) },
];

/**
 * §3 temporary active-role reference pool: top-N players per team per position
 * group, ranked by `overall` (allowed here — this only defines the population).
 */
export const REFERENCE_POOL_SPEC: ReadonlyArray<{ group: string; positions: string[]; topN: number }> = [
  { group: "QB", positions: ["QB"], topN: 1 },
  { group: "RB", positions: ["RB"], topN: 2 },
  { group: "WR", positions: ["WR"], topN: 4 },
  { group: "TE", positions: ["TE"], topN: 2 },
  { group: "OT", positions: ["OT"], topN: 2 },
  { group: "OG", positions: ["OG"], topN: 2 },
  { group: "C", positions: ["C"], topN: 1 },
  { group: "EDGE", positions: ["EDGE"], topN: 3 },
  { group: "DT", positions: ["DT"], topN: 3 },
  { group: "LB", positions: ["ILB", "OLB"], topN: 3 },
  { group: "CB", positions: ["CB"], topN: 4 },
  { group: "S", positions: ["S"], topN: 3 },
  { group: "K", positions: ["K"], topN: 1 },
  { group: "P", positions: ["P"], topN: 1 },
];
