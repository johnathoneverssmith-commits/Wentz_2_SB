import type { GameResult, LeagueState } from "@/domain";

/**
 * Where each team ranks on what it has actually *done* this season, rather
 * than on its roster ratings:
 *
 *  - offense: points scored per game
 *  - defense: points allowed per game
 *  - special teams: kicking and return points per game (field goals, and
 *    touchdowns on returns), read from the scoring summaries
 *
 * Built from the played regular-season games it is given, so a screen passes
 * what the GM has revealed and the ranks move with every box score. Until a
 * regular-season game has been played there is no production yet, and this
 * returns null for the caller to fall back on ratings.
 */
export interface ProductionRanks {
  offense: number;
  defense: number;
  /** null when nobody has scored on special teams yet (or the games carry no scoring summary) */
  specialTeams: number | null;
  /** games this team has played this season */
  games: number;
}

const FIELD_GOAL = /field goal|\bFG\b/i;
const RETURN_TD = /return touchdown|returns? .* for a touchdown|kickoff return|punt return/i;

function rankOf(code: string, value: Map<string, number>, higherIsBetter: boolean): number {
  const mine = value.get(code) ?? 0;
  let better = 0;
  for (const [other, v] of value) {
    if (other === code) continue;
    if (higherIsBetter ? v > mine : v < mine) better++;
  }
  return better + 1;
}

export function productionRanks(
  s: Pick<LeagueState, "teams">,
  games: readonly GameResult[],
): Map<string, ProductionRanks> | null {
  const played = games.filter((g) => g.phase === "REG" && g.played);
  if (played.length === 0) return null;

  const count = new Map<string, number>();
  const scored = new Map<string, number>();
  const allowed = new Map<string, number>();
  const special = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string, by: number): void => {
    m.set(k, (m.get(k) ?? 0) + by);
  };

  for (const g of played) {
    for (const [team, pf, pa] of [
      [g.homeTeam, g.homeScore, g.awayScore],
      [g.awayTeam, g.awayScore, g.homeScore],
    ] as const) {
      bump(count, team, 1);
      bump(scored, team, pf);
      bump(allowed, team, pa);
    }
    for (const p of g.scoringPlays ?? []) {
      if (FIELD_GOAL.test(p.description)) bump(special, p.team, 3);
      else if (RETURN_TD.test(p.description)) bump(special, p.team, 6);
    }
  }

  const perGame = (m: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    for (const code of Object.keys(s.teams)) {
      const n = count.get(code) ?? 0;
      out.set(code, n ? (m.get(code) ?? 0) / n : 0);
    }
    return out;
  };
  const off = perGame(scored);
  // a team that hasn't played has allowed nothing — which would rank it first
  const def = perGame(allowed);
  for (const code of Object.keys(s.teams)) if (!(count.get(code) ?? 0)) def.set(code, Infinity);
  const st = perGame(special);

  const stVaries = new Set(st.values()).size > 1;
  const out = new Map<string, ProductionRanks>();
  for (const code of Object.keys(s.teams)) {
    out.set(code, {
      offense: rankOf(code, off, true),
      defense: rankOf(code, def, false),
      specialTeams: stVaries ? rankOf(code, st, true) : null,
      games: count.get(code) ?? 0,
    });
  }
  return out;
}
