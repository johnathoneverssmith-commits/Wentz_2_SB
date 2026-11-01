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

/**
 * Exploit audit (Agent 7), beyond the first reproduction. The invariants:
 *  - a human release can never open a positional hole, at ANY stage;
 *  - the staff never re-sign a player this franchise released this season;
 *  - repeated / simultaneous repair requests are idempotent.
 */
describe("the staff cannot be turned into an acquisition mechanism", () => {
  const league = (stage: string) => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    fillRosterGaps(s);
    const gm = s.gms[0]!;
    gm.isHuman = true;
    gm.teamCode = "GB";
    s.stage = stage as typeof s.stage;
    return { s, a: { userId: "u", leagueId: "l", teamCode: "GB", gmId: gm.id } };
  };
  const mine = (s: ReturnType<typeof league>["s"], pos: string) =>
    Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === pos && !x.retired);

  it.each(["freeAgency", "freeAgencySummary", "trainingCamp", "preseason", "regularSeason", "midseasonFreeAgency", "midseasonFreeAgencySummary", "offseasonDraft"])(
    "cannot dig a hole by releasing, at %s",
    (stage) => {
      const { s, a } = league(stage);
      for (const q of mine(s, "QB")) {
        try {
          decideRelease(s, a, q.id);
        } catch {
          /* refused or blocked */
        }
      }
      expect(reconciliationIssues(s, "GB").filter((i) => i.kind === "position")).toEqual([]);
    },
  );

  it("injured reserve: an IR player does not count toward the minimum, and releasing him opens no hole", () => {
    const { s, a } = league("midseasonFreeAgencySummary");
    const qbs = mine(s, "QB").sort((x, y) => y.overall - x.overall);
    qbs[0]!.injury_status = { weeks_out_est: [30, 40] } as never; // on IR
    const healthy = qbs.slice(1);
    let kept = healthy.length;
    for (const q of healthy) {
      try {
        decideRelease(s, a, q.id);
        kept--;
      } catch (e) {
        expect((e as Error).message).toMatch(/minimum/);
      }
    }
    expect(kept).toBeGreaterThanOrEqual(1); // the healthy ones are held at the minimum, the IR player does not prop it up
    expect(() => decideRelease(s, a, qbs[0]!.id)).not.toThrow(); // shedding the injured star is legitimate
  });

  it("never re-signs a player this franchise released, even when a hole later opens by itself", () => {
    const { s, a } = league("freeAgencySummary");
    const qbs = mine(s, "QB").sort((x, y) => y.overall - x.overall);
    const star = qbs[0]!;
    decideRelease(s, a, star.id); // surplus depth: allowed
    expect(star.free_agent).toBe(true);
    // the other QBs retire (a hole that opens by itself); the released star is the best QB on the street
    for (const q of mine(s, "QB")) q.retired = true;
    decideStaffFix(s, a);
    expect(star.nfl_team, "he stays on the street").toBe("FA");
    expect(star.free_agent).toBe(true);
    // whoever the staff did sign is someone else, on the minimum
    const signed = Object.values(s.players).filter((x) => x.nfl_team === "GB" && x.position === "QB" && !x.retired);
    expect(signed.length).toBeGreaterThan(0);
    expect(signed.every((x) => x.id !== star.id)).toBe(true);
    expect(signed.every((x) => x.contract?.cap_hit_by_year?.[0] === 1 || x.id.startsWith("emg_") || x.contract?.total_value === 1)).toBe(true);
  });

  it("repeated or simultaneous repair requests change nothing the second time", () => {
    const { s, a } = league("freeAgencySummary");
    for (const q of mine(s, "OG")) {
      q.nfl_team = "FA";
      q.free_agent = true;
      q.contract = null;
    }
    decideStaffFix(s, a);
    const after = JSON.stringify(mine(s, "OG").map((x) => [x.id, x.contract]));
    expect(decideStaffFix(s, a)).toEqual({ events: [], unchanged: true });
    expect(decideStaffFix(s, a)).toEqual({ events: [], unchanged: true });
    expect(JSON.stringify(mine(s, "OG").map((x) => [x.id, x.contract]))).toBe(after);
  });

  it("a hole that opens by itself (expiry / trade) is still filled — legitimate readiness is preserved", () => {
    const { s, a } = league("midseasonFreeAgencySummary");
    for (const q of mine(s, "OG")) {
      q.nfl_team = "FA";
      q.free_agent = true;
      q.contract = null;
    }
    const out = decideStaffFix(s, a);
    expect(out.unchanged).toBeUndefined();
    expect(reconciliationIssues(s, "GB")).toEqual([]);
  });

  it("only the actor's own team is ever repaired (no other team can be named)", () => {
    const { s, a } = league("freeAgencySummary");
    for (const q of Object.values(s.players).filter((x) => x.nfl_team === "KC" && x.position === "OG")) {
      q.nfl_team = "FA";
      q.free_agent = true;
    }
    decideStaffFix(s, a);
    expect(reconciliationIssues(s, "KC").some((i) => i.kind === "position")).toBe(true);
  });
});
