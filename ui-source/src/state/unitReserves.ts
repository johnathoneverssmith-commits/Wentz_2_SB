import type { Player, Position } from "@/domain";

/**
 * The reserves behind a unit's starters, ordered the way `unitReport` orders a
 * position: an explicit depth order first (when the GM set one), then everyone
 * else by overall. A depth chart is an optional override, so a team that never
 * edited it still has reserves.
 */
export function reservesFor(
  players: Record<string, Player>,
  depthChart: Record<string, Partial<Record<Position, string[]>>> | undefined,
  team: string,
  positions: readonly string[],
  starterIds: ReadonlySet<string | null>,
  limit = 6,
): Player[] {
  const out: Player[] = [];
  for (const pos of new Set(positions)) {
    const order = depthChart?.[team]?.[pos as Position];
    const rank = new Map((order ?? []).map((id, i) => [id, i]));
    const list = Object.values(players)
      .filter((p) => !p.retired && p.nfl_team === team && p.position === pos && !starterIds.has(p.id))
      .sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER) || b.overall - a.overall);
    out.push(...list);
  }
  return out.slice(0, limit);
}
