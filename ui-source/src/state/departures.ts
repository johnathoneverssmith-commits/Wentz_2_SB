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
  const holder = s as unknown as { recentReleases?: Departures };
  const prev = holder.recentReleases;
  // The bar spans the season rollover: contracts expire and the year turns between a release and the next checkpoint
  // (the release is last season's by then). A departure counts this season and the next; each carries its OWN season, so
  // recording a new release never refreshes an old one (it used to restamp the whole league's history).
  const byTeam: Record<string, string[]> = {};
  const at: Record<string, number> = {};
  if (prev) {
    for (const [team, ids] of Object.entries(prev.byTeam)) {
      for (const id of ids) {
        const when = prev.at?.[stamp(team, id)] ?? prev.season; // a save from before per-player stamps: its whole list is that season's
        if (when < s.season - 1) continue; // aged out
        (byTeam[team] ??= []).push(id);
        at[stamp(team, id)] = when;
      }
    }
  }
  const list = byTeam[teamCode] ?? [];
  if (!list.includes(playerId)) byTeam[teamCode] = [...list, playerId];
  at[stamp(teamCode, playerId)] = s.season; // released (again) by THIS club now: only this club's bar starts from this season
  // copy on write: a trim plan runs on a shallow copy of a (possibly frozen) league, and must not touch the original's history
  holder.recentReleases = { season: s.season, byTeam, at };
}

/** Players this franchise released this season or last (since the last rollover), who the staff never sign back. */
export function recentReleasesOf(s: LeagueState, teamCode: string): string[] {
  const r = (s as unknown as { recentReleases?: Departures }).recentReleases;
  if (!r) return [];
  return (r.byTeam[teamCode] ?? []).filter((id) => (r.at?.[stamp(teamCode, id)] ?? r.season) >= s.season - 1);
}

/** One departure's key: the same player can be let go by two clubs in different seasons, each with its own age. */
const stamp = (teamCode: string, playerId: string): string => `${teamCode}|${playerId}`;

/** The saved shape. `at` ("team|player" -> the season that club let him go) is absent in saves from before departures aged per player. */
interface Departures {
  season: number;
  byTeam: Record<string, string[]>;
  at?: Record<string, number> | undefined;
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
