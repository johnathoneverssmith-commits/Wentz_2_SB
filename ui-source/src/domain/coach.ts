/**
 * The twelve jobs on a staff.
 *
 * The first three are real people carried from `src/engine/staff-data.ts` and
 * have gameplay effects on how a game is played. The nine after them are
 * fictional and work on a different axis entirely: they do not touch a single
 * play, they change how fast a player develops or declines between seasons,
 * and — for the trainers — how long an injury keeps somebody out.
 */
export const COACH_ROLES = [
  "HC",
  "OC",
  "DC",
  "QB",
  "RB",
  "OL",
  "WR",
  "DL",
  "LB",
  "DB",
  "ST",
  "MED",
] as const;
export type CoachRole = (typeof COACH_ROLES)[number];

/** The nine roles drafted from the generated pool rather than the real staffs. */
export const DEVELOPMENT_ROLES = ["QB", "RB", "OL", "WR", "DL", "LB", "DB", "ST", "MED"] as const;
export type DevelopmentRole = (typeof DEVELOPMENT_ROLES)[number];

export const COACH_ROLE_LABEL: Record<CoachRole, string> = {
  HC: "Head Coach",
  OC: "Offensive Coordinator",
  DC: "Defensive Coordinator",
  QB: "Quarterbacks Coach",
  RB: "Running Backs Coach",
  OL: "Offensive Line Coach",
  WR: "Wide Receivers Coach",
  DL: "Defensive Line Coach",
  LB: "Linebackers Coach",
  DB: "Defensive Backs Coach",
  ST: "Special Teams Coach",
  MED: "Medical Training Staff",
};

/**
 * Which players each development coach is responsible for.
 *
 * Long snappers do not exist in this league, so nothing maps to them. The
 * medical staff is absent from this table on purpose — it works on injury
 * recovery for everyone rather than on a position group.
 */
export const COACH_POSITION_GROUPS: Record<DevelopmentRole, readonly string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  OL: ["C", "OG", "OT"],
  WR: ["WR", "TE"],
  DL: ["DT", "EDGE"],
  LB: ["ILB", "OLB"],
  DB: ["CB", "S"],
  ST: ["K", "P"],
  MED: [],
};

/** The staff member who develops this position, or null if nobody does. */
export function coachRoleForPosition(position: string): DevelopmentRole | null {
  for (const role of DEVELOPMENT_ROLES) {
    if (COACH_POSITION_GROUPS[role].includes(position)) return role;
  }
  return null;
}

/**
 * Scheme identifiers — match `nfl-franchise-sim/src/engine/staff.ts`'s
 * `OffScheme`/`DefScheme` exactly (same vocabulary the real scheme-fit math
 * and `OFF_SCHEME_TAGS`/`DEF_SCHEME_TAGS` are keyed on), so a coach's
 * `.scheme` and a player's `scheme_tags` speak the same language whether the
 * data is Mock- or engine-generated.
 */
export const OFFENSE_SCHEMES = [
  "west_coast",
  "vertical",
  "spread",
  "power_run",
  "zone_run",
  "pro_style",
] as const;
export const DEFENSE_SCHEMES = [
  "four_three",
  "three_four",
  "multiple",
  "cover_3",
  "cover_2",
  "man_press",
] as const;
export type OffenseScheme = (typeof OFFENSE_SCHEMES)[number];
export type DefenseScheme = (typeof DEFENSE_SCHEMES)[number];

/** Display label for a scheme id, e.g. "west_coast" -> "West Coast". */
export const SCHEME_LABEL: Record<OffenseScheme | DefenseScheme, string> = {
  west_coast: "West Coast",
  vertical: "Vertical",
  spread: "Spread",
  power_run: "Power Run",
  zone_run: "Zone Run",
  pro_style: "Pro Style",
  four_three: "4-3",
  three_four: "3-4",
  multiple: "Multiple",
  cover_3: "Cover 3",
  cover_2: "Cover 2 (Tampa 2)",
  man_press: "Man Press",
};

export interface Coach {
  id: string;
  name: string;
  role: CoachRole;
  /** Team code, or null when on the open market. */
  team: string | null;
  contract: { yearsRemaining: number; annualValue: number } | null;

  // HC ratings (spec §6.4)
  discipline?: number;
  gameManagement?: number;
  aggressiveness?: number;

  /**
   * The development roles' single number. HC/OC/DC carry their own detailed
   * characteristics instead and do not use this.
   */
  overall?: number;

  // OC/DC ratings
  scheme?: OffenseScheme | DefenseScheme;
  playCallIq?: number;
  /** 0–100: share of pass calls (OC) / blitz rate (DC). */
  tendencyPassRate?: number;
  tendencyBlitzRate?: number;
}
