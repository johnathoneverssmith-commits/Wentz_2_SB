import type { LeagueState } from "@/domain";
import { classProfile } from "@/sim/leagueDna/classProfile";

/**
 * Refresh the public scouting read after a draft class is generated. Run
 * wherever `draftClass` is assigned, on the side that can see true ratings
 * (online redacts them from clients). Legacy leagues have none.
 */
export function refreshClassProfile(s: LeagueState): void {
  if (!s.dna) {
    delete s.draftClassProfile;
    return;
  }
  s.draftClassProfile = classProfile(s.draftClass, s.season);
}
