import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { reconciliationIssues } from "@/state/reconciliation.ts";

import { decideRelease, decideStaffFix } from "../src/decide.js";

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

  it("on a legal roster changes nothing, and says so", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    fillRosterGaps(s);
    const gm = s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    s.stage = "freeAgencySummary";
    expect(reconciliationIssues(s, "GB")).toEqual([]);
    const out = decideStaffFix(s, { userId: "u", leagueId: "l", teamCode: "GB", gmId: gm.id });
    expect(out).toEqual({ events: [], unchanged: true });
  });

  it("only at a free-agency summary", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    s.stage = "regularSeason";
    expect(() => decideStaffFix(s, { userId: "u", leagueId: "l", teamCode: "GB", gmId: "g" })).toThrow(/summary/);
  });
});

/**
 * Loophole found in the Agent 7 audit: release a star, press "staff fix", and the staff re-signed him on a one-year
 * minimum (a $27M x 5 QB came back at $1M). A GM may not dig the positional hole the staff fill.
 */
describe("a GM cannot use the staff to re-price a player", () => {
  const setup = () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    fillRosterGaps(s);
    const gm = s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    s.stage = "freeAgencySummary";
    return { s, a: { userId: "u", leagueId: "l", teamCode: "GB", gmId: gm.id } };
  };
  it("refuses a release that leaves a position below its minimum", () => {
    const { s, a } = setup();
    const qbs = Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === "QB" && !x.retired);
    // the cut that would leave fewer than the minimum is refused; none of them is cut
    let refused = 0;
    for (const q of qbs) {
      try {
        decideRelease(s, a, q.id);
      } catch (e) {
        refused++;
        expect((e as Error).message).toMatch(/minimum/);
      }
    }
    expect(refused).toBeGreaterThan(0);
    const left = Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === "QB" && !x.retired);
    expect(left.length).toBeGreaterThan(0);
    // and nothing for the staff to do
    expect(decideStaffFix(s, a)).toEqual({ events: [], unchanged: true });
  });
  it("still lets a GM cut surplus depth", () => {
    const { s, a } = setup();
    const qbs = Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === "QB").sort((x, y) => x.overall - y.overall);
    expect(qbs.length).toBeGreaterThan(1);
    expect(() => decideRelease(s, a, qbs[0]!.id)).not.toThrow();
  });
});
