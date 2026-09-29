import { describe, expect, it } from "vitest";

import { applyRelease, planStaffTrim, reconciliationIssues, rosterOf } from "./reconciliation.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * "Let my staff trim the roster" plans every cut before sending any, so
 * online it is one batch and one download rather than one of each per cut.
 */
describe("the staff's trim plan", () => {
  it("leaves the league alone, and applied, makes the roster legal", () => {
    const s = createLeague(44, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
    fillRosterGaps(s);
    // six spare bodies over the limit: free agents dropped onto the roster
    const spares = Object.values(s.players)
      .filter((p) => p.free_agent && !p.retired)
      .slice(0, 6);
    for (const p of spares) {
      p.free_agent = false;
      p.nfl_team = "GB";
      p.contract = { ...(p.contract ?? {}), years_remaining: 1, cap_hit_by_year: [1], guaranteed: 0 } as never;
    }
    expect(reconciliationIssues(s, "GB").some((i) => i.kind === "roster")).toBe(true);

    const before = JSON.stringify({ gb: rosterOf(s, "GB").map((p) => p.id), cap: s.teams.GB!.cap });
    const plan = planStaffTrim(s, "GB");
    expect(JSON.stringify({ gb: rosterOf(s, "GB").map((p) => p.id), cap: s.teams.GB!.cap })).toBe(before);
    expect(plan.length).toBeGreaterThanOrEqual(6);

    for (const p of plan) applyRelease(s, "GB", p.id);
    expect(reconciliationIssues(s, "GB").filter((i) => i.kind === "roster" || i.kind === "cap")).toEqual([]);
  });
});
