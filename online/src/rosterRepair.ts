/**
 * Roster repair: the one place the league signs players *for* a franchise.
 *
 * The agreed design: staff repair an incomplete roster automatically, for
 * human-controlled and CPU-controlled franchises alike, and a human GM neither
 * starts that nor picks who is signed. So this module is the whole interface:
 *
 *  - There is no HTTP route here and none may be added. Nothing a request can
 *    carry reaches it.
 *  - `authorizeRosterRepair` is the only way to get the capability, it refuses
 *    outside a repair checkpoint, and the capability is an opaque object (a
 *    private symbol brand) that JSON cannot forge.
 *  - `applyRosterRepair` takes no player, salary or position. The staff choose
 *    (`reconcileCpuTeam`: cut to cap/limit, then the best street free agent at
 *    each empty position on the one-year minimum, else a placeholder), under
 *    the normal cap and roster rules.
 *
 * Repair *policy* (who is cut or signed, in what order) lives in
 * `ui-source/src/state/reconciliation.ts`, owned by Agent 1; this file only
 * decides when the staff may act and for whom.
 */
import type { LeagueState } from "@/domain";
import { reconcileCpuTeam, reconciliationIssues, recentReleasesOf } from "@/state/reconciliation.ts";

/** The checkpoints at which the staff square rosters up. */
export type RepairCheckpoint = "freeAgencySummary" | "midseasonFreeAgencySummary";

/** The stage the league is in while it is at the checkpoint, or has just left it. */
const WINDOW: Record<RepairCheckpoint, readonly string[]> = {
  freeAgencySummary: ["freeAgencySummary", "trainingCamp"],
  midseasonFreeAgencySummary: ["midseasonFreeAgencySummary", "midseasonDepthChart"],
};

const BRAND: unique symbol = Symbol("rosterRepairAuthorization");

export interface RosterRepairAuthorization {
  readonly [BRAND]: true;
  readonly teamCode: string;
  readonly checkpoint: RepairCheckpoint;
}

/** Server code only. Throws unless the league is at (or just past) the checkpoint. */
export function authorizeRosterRepair(
  state: LeagueState,
  teamCode: string,
  checkpoint: RepairCheckpoint,
): RosterRepairAuthorization {
  if (!state.teams[teamCode]) throw new Error(`Unknown team: ${teamCode}`);
  if (!WINDOW[checkpoint]?.includes(state.stage)) {
    throw new Error(`Roster repair is only authorised around ${checkpoint}, not in ${state.stage}.`);
  }
  return { [BRAND]: true, teamCode, checkpoint };
}

/** Whether the capability is a real one (not hand-built or deserialised). */
export function isRepairAuthorization(x: unknown): x is RosterRepairAuthorization {
  return typeof x === "object" && x !== null && (x as Record<symbol, unknown>)[BRAND] === true;
}

/**
 * Repair one franchise. Idempotent: a legal roster is left alone.
 * Returns whether anything was still wrong afterwards.
 */
export function applyRosterRepair(state: LeagueState, auth: RosterRepairAuthorization): { remaining: number } {
  if (!isRepairAuthorization(auth)) throw new Error("Not an authorised roster repair.");
  // the authorisation was minted for a moment; it does not outlive it
  if (!WINDOW[auth.checkpoint].includes(state.stage)) {
    throw new Error(`The ${auth.checkpoint} repair window has closed.`);
  }
  if (reconciliationIssues(state, auth.teamCode).length > 0) {
    // The staff never re-sign a player this franchise itself released this season (`decideRelease` records them),
    // however the repair was started — a GM's button, a commissioner's force, an absent GM's autopilot. Held off the
    // street for the repair only, so releasing a star cannot become re-signing him on the minimum.
    const tag = `HELD:${auth.teamCode}`;
    const held = recentReleasesOf(state, auth.teamCode)
      .map((id) => state.players[id])
      .filter((x): x is NonNullable<typeof x> => !!x && x.free_agent && x.nfl_team === "FA");
    for (const x of held) x.nfl_team = tag;
    try {
      reconcileCpuTeam(state, auth.teamCode);
    } finally {
      for (const x of held) if (x.nfl_team === tag) x.nfl_team = "FA";
    }
  }
  return { remaining: reconciliationIssues(state, auth.teamCode).length };
}
