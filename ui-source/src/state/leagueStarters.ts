import type { LeagueState, Player, Position } from "@/domain";
import { ROSTER_TEMPLATE } from "@/sim/roster-template";

/** How many start at each position, from the roster template. */
export function startersAt(pos: Position): number {
  return ROSTER_TEMPLATE.find((r) => r.pos === pos)?.starters ?? 0;
}

/**
 * The league's typical starter at each position: the average overall of every
 * team's starters there, in each team's own depth-chart order.
 *
 * Read from ratings and depth charts only — never from game results — so it
 * shows a GM nothing they haven't been shown. A position nobody starts at (or
 * a league with no players there) is left out rather than reported as zero.
 */
export function leagueStarterOverall(
  s: Pick<LeagueState, "players" | "teams" | "depthChart">,
): Partial<Record<Position, number>> {
  const byTeamPos = new Map<string, Player[]>();
  for (const p of Object.values(s.players)) {
    if (p.retired || !s.teams[p.nfl_team]) continue;
    const key = `${p.nfl_team}|${p.position}`;
    const list = byTeamPos.get(key);
    if (list) list.push(p);
    else byTeamPos.set(key, [p]);
  }
  const sum = new Map<Position, { total: number; n: number }>();
  for (const [key, players] of byTeamPos) {
    const [team, pos] = key.split("|") as [string, Position];
    const starters = startersAt(pos);
    if (starters <= 0) continue;
    // the same order depthAt uses: the chart first, anyone not on it after, by overall
    const order = s.depthChart?.[team]?.[pos];
    const rank = new Map((order ?? []).map((id, i) => [id, i]));
    players.sort(
      (a, b) =>
        (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
        b.overall - a.overall,
    );
    const acc = sum.get(pos) ?? { total: 0, n: 0 };
    for (const p of players.slice(0, starters)) {
      acc.total += p.overall;
      acc.n += 1;
    }
    sum.set(pos, acc);
  }
  const out: Partial<Record<Position, number>> = {};
  for (const [pos, { total, n }] of sum) if (n > 0) out[pos] = Math.round(total / n);
  return out;
}
