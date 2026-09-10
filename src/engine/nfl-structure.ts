/**
 * NFL alignment: 32 teams → 2 conferences × 4 divisions × 4 teams.
 * Codes match the player pool / nflverse (`LA` = Rams, `LAC` = Chargers,
 * `WAS` = Commanders, `LV` = Raiders, `JAX` = Jaguars). Current since 2002
 * (Texans added); unchanged through 2025.
 */

export type Conference = "AFC" | "NFC";
export type DivisionName = "East" | "North" | "South" | "West";
export type DivisionId = `${Conference} ${DivisionName}`;

export const DIVISIONS: Record<DivisionId, readonly string[]> = {
  "AFC East": ["BUF", "MIA", "NE", "NYJ"],
  "AFC North": ["BAL", "CIN", "CLE", "PIT"],
  "AFC South": ["HOU", "IND", "JAX", "TEN"],
  "AFC West": ["DEN", "KC", "LAC", "LV"],
  "NFC East": ["DAL", "NYG", "PHI", "WAS"],
  "NFC North": ["CHI", "DET", "GB", "MIN"],
  "NFC South": ["ATL", "CAR", "NO", "TB"],
  "NFC West": ["ARI", "LA", "SEA", "SF"],
} as const;

export const DIVISION_IDS = Object.keys(DIVISIONS) as DivisionId[];

const TEAM_DIVISION = new Map<string, DivisionId>();
for (const id of DIVISION_IDS) {
  for (const t of DIVISIONS[id]) TEAM_DIVISION.set(t, id);
}

/** All 32 team codes, in a stable order (division order, then within division). */
export const NFL_TEAMS: readonly string[] = DIVISION_IDS.flatMap((id) => DIVISIONS[id]);

export function divisionOf(team: string): DivisionId {
  const d = TEAM_DIVISION.get(team);
  if (!d) throw new Error(`divisionOf: unknown team ${team}`);
  return d;
}

export function conferenceOf(team: string): Conference {
  return divisionOf(team).startsWith("AFC") ? "AFC" : "NFC";
}

export function divisionRivals(team: string): string[] {
  return DIVISIONS[divisionOf(team)].filter((t) => t !== team);
}

/** The four division ids in a conference, in East/North/South/West order. */
export function divisionsIn(conf: Conference): DivisionId[] {
  return (["East", "North", "South", "West"] as const).map((n) => `${conf} ${n}` as DivisionId);
}
