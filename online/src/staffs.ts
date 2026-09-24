import type { LeagueState } from "@/domain";
import { engineStaffFor } from "@/state/coachScale.ts";

import type { Staff } from "../../src/engine/staff.js";

/**
 * The two franchises' HC/OC/DC for one game, in the engine's units.
 *
 * Online games never told the engine who was coaching either — the
 * calibrated coaching layer sat idle in every franchise game. Both sides or
 * neither: the engine gives the coaching layer to a game only as a pair.
 */
export function staffPairOf(state: LeagueState, home: string, away: string): { homeStaff: Staff; awayStaff: Staff } {
  return {
    homeStaff: engineStaffFor(state, home) as Staff,
    awayStaff: engineStaffFor(state, away) as Staff,
  };
}
