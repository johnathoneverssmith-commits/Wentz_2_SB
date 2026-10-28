/**
 * Each team's competitive window, on its own so the trade model (`tradeModel.ts`) can read it without importing the rules.
 */
import type { LeagueState, Position } from "@/domain";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";

import { teamWindow } from "./draftBoard.ts";

/** What an empty starting slot counts as when a team's strength is ranked. */
const EMPTY_POSITION_BASE = 42;

/** Each team's timeline alone, -1 (rebuilding) to +1 (contending): the draft reads it, and so does free agency when its market opens. */
export function readTeamTimeline(s: LeagueState): Map<string, number> {
  const codes = Object.keys(s.teams);
  const byTeam = new Map<string, Map<Position, number[]>>();
  for (const p of Object.values(s.players)) {
    if (p.retired || p.free_agent || !s.teams[p.nfl_team]) continue;
    const m = byTeam.get(p.nfl_team) ?? new Map<Position, number[]>();
    const l = m.get(p.position);
    if (l) l.push(p.overall);
    else m.set(p.position, [p.overall]);
    byTeam.set(p.nfl_team, m);
  }
  const strength = new Map<string, number>();
  for (const code of codes) {
    let sum = 0;
    let n = 0;
    for (const row of ROSTER_TEMPLATE) {
      if (row.starters === 0) continue;
      const l = [...(byTeam.get(code)?.get(row.pos) ?? [])].sort((a, b) => b - a).slice(0, row.starters);
      while (l.length < row.starters) l.push(EMPTY_POSITION_BASE);
      for (const v of l) {
        sum += v;
        n++;
      }
    }
    strength.set(code, sum / n);
  }
  const ranked = [...codes].sort((a, b) => strength.get(b)! - strength.get(a)! || (a < b ? -1 : 1));
  const timeline = new Map<string, number>();
  ranked.forEach((code, i) => {
    const t = s.teams[code]!;
    const games = t.wins + t.losses + t.ties;
    timeline.set(code, teamWindow({ winPct: games === 0 ? 0.5 : (t.wins + 0.5 * t.ties) / games, strengthRank: i + 1, teams: codes.length }));
  });
  return timeline;
}

