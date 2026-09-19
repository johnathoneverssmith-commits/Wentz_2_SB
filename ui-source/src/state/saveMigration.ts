import type { LeagueState } from "@/domain";
import { ensureDraftPicks } from "./draftPicks.ts";

/**
 * The local single-player save's schema version.
 *
 * Bump this whenever a change to `LeagueState`'s shape means an older save
 * needs `migrateLeagueSave` to run before the store can trust it — a field
 * that moved, changed meaning, or has to be backfilled. Adding a field that
 * defaults sensibly when absent (most of them) does not need a bump; zustand
 * only calls the migration at all when a save's own stamped version is
 * behind this one.
 */
export const CURRENT_SAVE_VERSION = 3;

/**
 * Bring a save written by an older build up to the shape the current store
 * expects, in place.
 *
 * Pulled out of the `persist` config in `store.ts` so it can be unit tested
 * without going through zustand's rehydration machinery — the save/load
 * spec's "load a fixture from an old version, migrate, validate invariants"
 * requirement needs a function to call directly, not a side effect of
 * mounting the store.
 *
 * Deliberately permissive about what it's handed back, matching the
 * behaviour this had inline before it moved here: something that plainly
 * is not a `LeagueState` (an empty object, a stray string, `undefined`)
 * round-trips untouched rather than being rejected. zustand's own
 * rehydration is what decides whether a save that still doesn't look right
 * afterward is usable; this function's job is only the one backfill it has
 * ever needed to do, not validation.
 */
export function migrateLeagueSave(persisted: unknown, version: number): LeagueState {
  const st = persisted as LeagueState;

  // Draft picks and the depth chart both shipped after leagues could already
  // be under way, so a save from before either existed has neither — and
  // `ensureDraftPicks` otherwise only runs at league creation and at the
  // season rollover, so a league that was mid-season when this landed would
  // never grow one on its own. Both are safe to backfill unconditionally:
  // an empty depth chart falls back to overall-order exactly as it always
  // has, and `ensureDraftPicks` is itself idempotent — it only creates picks
  // that do not already exist.
  if (st && st.teams && version < 3) {
    st.depthChart ??= {};
    ensureDraftPicks(st, st.season);
  }

  return st;
}
