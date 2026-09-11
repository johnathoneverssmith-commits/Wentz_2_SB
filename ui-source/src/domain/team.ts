export type Conference = "AFC" | "NFC";
export type DivisionName = "North" | "South" | "East" | "West";

export interface TeamMeta {
  /** Stable team code, e.g. "CLE". */
  code: string;
  city: string;
  name: string;
  abbr: string;
  /** Primary brand color (hex). Drives --team when this team is controlled. */
  color: string;
  /** Text color that reads on `color` (for badges). */
  onColor: string;
  conference: Conference;
  division: DivisionName;
}

export type ControlledBy = { kind: "human"; gmId: string } | { kind: "ai" };

export interface TeamState {
  code: string;
  controlledBy: ControlledBy;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Ranks are 1-based; 0 means "not yet computed". */
  divisionRank: number;
  conferenceRank: number;
  leagueRank: number;
  /**
   * `overall` / `offense` / `defense` / `specialTeams` are the **starting
   * lineup** ratings — the number that drives the sim and is shown as "Team
   * overall". `roster*` are the whole-53 averages.
   */
  ratings: {
    overall: number;
    offense: number;
    defense: number;
    specialTeams: number;
    overallRank: number;
    offenseRank: number;
    defenseRank: number;
    specialTeamsRank: number;
    rosterOverall: number;
    rosterOverallRank: number;
  };
  /** $M, matching Contract/Coach contract fields (contractValueFor's "$M/year"
   *  convention) — not CLAUDE.md's general "whole dollars" rule, which this
   *  corner of the data model predates. `used` is recomputed by
   *  recomputeTeamRatings from the current roster + staff's contracts;
   *  `dead` (cap charged for players no longer on the roster) isn't modeled
   *  yet — no per-player dead-cap tracking exists — and stays 0. */
  cap: {
    total: number;
    used: number;
    dead: number;
  };
  /** Postseason only. 1–7, or 0 if not seeded. */
  playoffSeed: number;
  /** Rolling playoff-odds percentage (0–100), recomputed as the season runs. */
  playoffOdds: number;
}

export function record(t: Pick<TeamState, "wins" | "losses" | "ties">): string {
  return t.ties > 0 ? `${t.wins}-${t.losses}-${t.ties}` : `${t.wins}-${t.losses}`;
}

export function winPct(t: Pick<TeamState, "wins" | "losses" | "ties">): number {
  const g = t.wins + t.losses + t.ties;
  return g === 0 ? 0 : (t.wins + 0.5 * t.ties) / g;
}
