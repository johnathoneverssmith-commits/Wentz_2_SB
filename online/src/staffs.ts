import type { LeagueState } from "@/domain";
import { engineStaffFor } from "@/state/coachScale.ts";
import { gamePlanFor } from "@/state/gamePlan.ts";

import type { Staff } from "../../src/engine/staff.js";

/**
 * The two franchises' HC/OC/DC for one game, in the engine's units.
 *
 * Online games never told the engine who was coaching either — the
 * calibrated coaching layer sat idle in every franchise game. Both sides or
 * neither: the engine gives the coaching layer to a game only as a pair.
 */
/**
 * The two teams' game plans for one game, in the engine's options, and as the
 * record kept on the stored result. A replay uses the *stored* plans: a GM
 * who changes their plan after a block was simulated must not change what
 * that block's games were.
 */
export function planPairOf(state: LeagueState, home: string, away: string) {
  const plans = { home: gamePlanFor(state, home), away: gamePlanFor(state, away) };
  return { homePlan: plans.home, awayPlan: plans.away, record: plans };
}

export function staffPairOf(state: LeagueState, home: string, away: string): { homeStaff: Staff; awayStaff: Staff } {
  return {
    homeStaff: engineStaffFor(state, home) as Staff,
    awayStaff: engineStaffFor(state, away) as Staff,
  };
}
