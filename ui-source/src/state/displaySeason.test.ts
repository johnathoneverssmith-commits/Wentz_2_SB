import { describe, expect, it } from "vitest";

import { displaySeasonFor } from "./stageMachine.ts";

/**
 * Labels name the season being prepared for, not the one just finished.
 *
 * A new league starts at 2026 internally and plays 2027 first; its whole
 * opening offseason — the fantasy draft, the coaching draft, free agency,
 * camp — is 2027's. After the 2027 season, the draft that follows is the
 * 2028 draft. Only the label moves; `state.season` does not.
 */
describe("the year a screen shows", () => {
  it("reads 2027 for a new league from setup through its first Super Bowl", () => {
    for (const stage of ["setup", "fantasyDraft", "coachingDraft", "freeAgency", "trainingCamp", "offseasonDepthChart"] as const) {
      expect(displaySeasonFor(2026, stage), stage).toBe(2027);
    }
    // the year turns over on the way into the preseason
    for (const stage of ["preseason", "regularSeason", "tradeDeadline", "playoffs", "endOfSeasonAnnounce"] as const) {
      expect(displaySeasonFor(2027, stage), stage).toBe(2027);
    }
  });

  it("labels the offseason after a season with the next year", () => {
    for (const stage of ["offseasonRetirement", "offseasonDraftPrep", "offseasonDraft", "offseasonSignings", "freeAgency", "trainingCamp"] as const) {
      expect(displaySeasonFor(2027, stage), stage).toBe(2028);
    }
  });
});
