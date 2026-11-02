import type { LeagueState } from "@/domain";

/**
 * Who a franchise itself let go, so the staff never sign them back below their price.
 *
 * Kept in its own module (no imports of the league rules) so the roster fill in `seed.ts`, the reconciliation
 * cuts, the checkpoint repair and the league server can all read and write it without import cycles.
 */
/**
 * Remember that this franchise let this player go this season, so the staff never sign him back at the emergency
 * price (`ownDepartures` in rosterRepair.ts). Same field and shape as the league server's `recentReleases`, which a
 * GM's release also writes (a union, so recording twice is harmless); kept off the typed state so the two writers
 * cannot disagree about the declaration.
 */
export function recordDeparture(s: LeagueState, teamCode: string, playerId: string): void {
  const holder = s as unknown as { recentReleases?: { season: number; byTeam: Record<string, string[]> } };
  const prev = holder.recentReleases;
  // The bar spans the season rollover: contracts expire and the year turns between a release and the next checkpoint
  // (the release is last season's by then). History from this season or the one before is kept; older is dropped.
  const base = prev && prev.season >= s.season - 1 ? prev.byTeam : {};
  const list = base[teamCode] ?? [];
  if (prev && prev.season === s.season && list.includes(playerId)) return;
  // copy on write: a trim plan runs on a shallow copy of a (possibly frozen) league, and must not touch the original's history
  holder.recentReleases = { season: s.season, byTeam: { ...base, [teamCode]: list.includes(playerId) ? list : [...list, playerId] } };
}

/** Players this franchise released this season or last (since the last rollover), who the staff never sign back. */
export function recentReleasesOf(s: LeagueState, teamCode: string): string[] {
  const r = (s as unknown as { recentReleases?: { season: number; byTeam: Record<string, string[]> } }).recentReleases;
  return r && r.season >= s.season - 1 ? (r.byTeam[teamCode] ?? []) : [];
}


/**
 * Everyone this franchise let go since the last rollover: released (a GM's release or a staff cut) or left to
 * run out of contract. Contracts expire at a season's end, stamped with that season, before the year turns, so
 * "expired last season" counts as recent.
 */
export function departedFrom(s: LeagueState, teamCode: string): Set<string> {
  const out = new Set<string>(recentReleasesOf(s, teamCode));
  for (const p of Object.values(s.players)) {
    if (p.free_agent && p.expired_from === teamCode && p.expired_season !== undefined && p.expired_season >= s.season - 1) out.add(p.id);
  }
  return out;
}
