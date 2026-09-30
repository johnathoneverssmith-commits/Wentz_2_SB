import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { reconciliationIssues } from "@/state/reconciliation.ts";

import { decideStaffFix } from "../src/decide.js";

/**
 * A GM a guard short at the free-agency summary had no way to fill the hole
 * from that screen, and the check-in stays locked until the roster is legal.
 */
describe("the staff fixing a GM's roster at the summary", () => {
  it("fills an empty position with a street free agent", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    fillRosterGaps(s);
    const gm = s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    s.stage = "freeAgencySummary";
    // release both guards
    for (const p of Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === "OG")) {
      p.nfl_team = "FA";
      p.free_agent = true;
      p.contract = null;
    }
    expect(reconciliationIssues(s, "GB").some((i) => i.kind === "position")).toBe(true);
    decideStaffFix(s, { userId: "u", leagueId: "l", teamCode: "GB", gmId: gm.id });
    expect(reconciliationIssues(s, "GB")).toEqual([]);
  });

  it("only at a free-agency summary", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    s.stage = "regularSeason";
    expect(() => decideStaffFix(s, { userId: "u", leagueId: "l", teamCode: "GB", gmId: "g" })).toThrow(/summary/);
  });
});
