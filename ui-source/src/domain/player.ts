/**
 * Player shape — a field-for-field mirror of
 * `nfl-franchise-sim/src/schema/player.ts` (the engine's zod source of truth),
 * plus the season-statistics and draft-info fields the spec (§6.3) requires for
 * the UI that the engine schema does not yet carry.
 *
 * When the real engine is wired in, this file collapses to a re-export of the
 * engine's `Player` type + a `PlayerSeason` extension. Keep the names identical.
 */

export const POSITIONS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "OT",
  "OG",
  "C",
  "EDGE",
  "DT",
  "ILB",
  "OLB",
  "CB",
  "S",
  "K",
  "P",
] as const;
export type Position = (typeof POSITIONS)[number];

/** Coarse position groups used by roster tabs / depth-chart UI. */
export const POSITION_GROUPS = [
  "QB",
  "RB",
  "WR",
  "TE",
  "OL",
  "DL",
  "EDGE",
  "LB",
  "CB",
  "S",
  "K",
  "P",
] as const;
export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const POSITION_TO_GROUP: Record<Position, PositionGroup> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  OT: "OL",
  OG: "OL",
  C: "OL",
  EDGE: "EDGE",
  DT: "DL",
  ILB: "LB",
  OLB: "LB",
  CB: "CB",
  S: "S",
  K: "K",
  P: "P",
};

export type InjuryStatusValue = "out" | "doubtful" | "questionable";

export interface InjuryHistoryEntry {
  season: number;
  type: string;
  severity: string;
  weeks_out: number;
}

export interface Contract {
  team_id: string;
  years_remaining: number;
  total_value: number;
  guaranteed: number;
  /** Cap hit per remaining contract year, index 0 === upcoming season. */
  cap_hit_by_year: number[];
  signing_bonus: number;
  /**
   * Bonus money already prorated onto every remaining year, from a
   * restructure. It rides along through an extension — that is what stops
   * "restructure now, extend the debt away later" from being free money.
   */
  prorated_per_year?: number;
}

export interface InjuryStatus {
  status: InjuryStatusValue;
  /** [min, max] weeks, or null when unknown / week-to-week. */
  weeks_out_est: [number, number] | null;
  description: string;
}

/** Draft provenance for a player drafted under the current regime (spec §6.3). */
export interface DraftInfo {
  round: number;
  pick: number;
  class_year: number;
}

export type RetirementStatus = "active" | "retiring" | "returning";

/** Per-category counting stats. Position determines which are populated. */
export interface PlayerStatLine {
  gamesPlayed: number;
  // passing
  passAtt?: number;
  passCmp?: number;
  passYds?: number;
  passTd?: number;
  passInt?: number;
  sacked?: number;
  // rushing
  rushAtt?: number;
  rushYds?: number;
  rushTd?: number;
  fumbles?: number;
  // receiving
  targets?: number;
  rec?: number;
  recYds?: number;
  recTd?: number;
  // defense
  tackles?: number;
  sacks?: number;
  defInt?: number;
  passDef?: number;
  ffum?: number;
  defTd?: number;
  // kicking
  fgm?: number;
  fga?: number;
  xpm?: number;
  xpa?: number;
  longFg?: number;
  // returns
  krAtt?: number;
  krYds?: number;
  krTd?: number;
  prAtt?: number;
  prYds?: number;
  prTd?: number;
}

export interface Player {
  id: string;
  name: string;
  position: Position;
  age: number;
  /** Team code the player belongs to in-game (not the real-world roster). */
  nfl_team: string;
  years_pro: number;

  overall: number;
  /** 0–99 sub-ratings; keys are position-relevant (see engine schema). */
  attributes: Record<string, number>;

  scheme_tags: string[];

  dev_age_threshold: number;
  decline_age_threshold: number;
  injury_history: InjuryHistoryEntry[];

  contract: Contract | null;
  free_agent: boolean;

  injury_status: InjuryStatus | null;
  retired: boolean;

  // --- UI / franchise extensions (spec §6.3) ---
  draft_info?: DraftInfo;
  retirement_status?: RetirementStatus;
  /** Season a player retired in — how `forgetOldRetirees` knows when to let go. */
  retired_season?: number;
  /** College, for rookies (spec §6.3 identity). */
  college?: string;
  /** Accumulating current-season stats; reset per season (preseason resets at Wk1). */
  season_stats?: PlayerStatLine;
  /** Scheme fit 0–99 vs the team's current OC/DC (spec §6.3). */
  scheme_fit?: number;
}

/** overall → the elite/mid/low class the mockups colour by. */
export function ovrClass(overall: number): "elite" | "mid" | "low" {
  if (overall >= 85) return "elite";
  if (overall >= 75) return "mid";
  return "low";
}
