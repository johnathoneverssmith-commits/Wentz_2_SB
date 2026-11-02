import { describeRepair, repairsFor } from "@/state/rosterRepair";
import type { LeagueState } from "@/domain";

/**
 * What the staff did to field a lineup, said once the roster was fixed.
 * There is nothing here to click: the repair is not the GM's choice
 * (`state/rosterRepair.ts`); this only tells them it happened.
 */
export function RosterRepairNotice({ state, team }: { state: Pick<LeagueState, "rosterRepairs" | "season">; team: string }) {
  const latest = repairsFor(state, team, state.season)[0];
  if (!latest) return null;
  const text = describeRepair(latest);
  if (!text) return null;
  return (
    <div className="notice" role="status" data-testid="roster-repair-notice">
      {text}
    </div>
  );
}
