import type { LeagueState } from "@/domain";
import { syncAiGms } from "./aiGms.ts";
import { ensureDraftPicks, forgetSpentPicks, pickKey } from "./draftPicks.ts";

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
export const CURRENT_SAVE_VERSION = 4;

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
  if (st && st.players) upgradeLeagueState(st);

  return st;
}

/**
 * Idempotent fixes an existing league needs to pick up a rules change —
 * run on every load, locally (above) and by the league server on every
 * read, so a league already under way when a fix ships gets it too. Online
 * there was no such step: a league kept whatever shape it was created with.
 * Each fix here must be safe to apply to a league that already has it.
 */
export function upgradeLeagueState(st: LeagueState): void {
  // a league from before CPU GMs had names and philosophies gets them now (`aiGms.ts`)
  if (!st.aiGms) syncAiGms(st);

  // No OLB slot exists on any depth chart; the pool's two OLBs (Frankie
  // Luvu, Isaiah Simmons — off-ball backers) sat unplayable, and "best fit"
  // still recommended signing them.
  for (const p of Object.values(st.players)) if (p.position === "OLB") p.position = "ILB";

  // Between a season's rookie draft and the next preseason — and all of a
  // league's first offseason, which has no draft at all — this season's
  // picks are spent (or never usable), yet they sat on every trade screen,
  // tradeable, until the rollover.
  if (st.draftPicks && PICKS_SPENT_STAGES.has(st.stage)) forgetSpentPicks(st, st.season + 1);

  // an open offer can't include a pick that no longer exists (spent, or a
  // draft already held): it would trade nothing for something
  if (st.trades && st.draftPicks) {
    const exists = (a: { kind: string; pick?: { year: number; round: number; originalTeam: string } }) =>
      a.kind !== "pick" || !a.pick || !!st.draftPicks[pickKey(a.pick.year, a.pick.round, a.pick.originalTeam)];
    for (const t of st.trades) {
      if ((t.status === "offered" || t.status === "pending") && !(t.fromAssets.every(exists) && t.toAssets.every(exists))) {
        t.status = "rejected";
      }
    }
  }
}

const PICKS_SPENT_STAGES = new Set<string>([
  "setup",
  "fantasyDraft",
  "fantasyDraftSummary",
  "coachingDraft",
  "coachingDraftSummary",
  "offseasonDraftSummary",
  "offseasonSignings",
  "freeAgency",
  "freeAgencySummary",
  "offseasonFreeAgency",
  "trainingCamp",
  "trainingCampResults",
  "hoodedFigureEncounter",
  "offseasonDepthChart",
]);
