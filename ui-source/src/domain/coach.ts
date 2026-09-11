export type CoachRole = "HC" | "OC" | "DC";

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

  // OC/DC ratings
  scheme?: OffenseScheme | DefenseScheme;
  playCallIq?: number;
  /** 0–100: share of pass calls (OC) / blitz rate (DC). */
  tendencyPassRate?: number;
  tendencyBlitzRate?: number;
}
