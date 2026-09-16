import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginFreeAgencyEvent } from "@/state/freeAgencyEvent.ts";
import {
  applyRelease,
  capUsed,
  checkRelease,
  fillPositionalGaps,
  isReconciled,
  reconcileCpuTeam,
  reconciliationIssues,
  releasePenalty,
  rosterOf,
} from "@/state/reconciliation.ts";
import { ROSTER_SIZE } from "@/sim/roster-template.ts";

/**
 * Change 4 — putting the rules back.
 *
 * Bidding suspends the cap, the roster maximum and the positional minimums so
 * a team can win a player it cannot yet fit. Reconciliation is where that
 * comes due, and it reports every violation together — fixing the cap by
 * cutting people can break a positional minimum, and filling a position can
 * break the cap, so one-at-a-time reporting would send a GM in circles.
 */
function league(): LeagueState {
  const s = createLeague(2580, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  beginFreeAgencyEvent(s);
  return s;
}

describe("what counts as reconciled", () => {
  it("reports nothing wrong with a legal roster", () => {
    const s = league();
    // a freshly filled roster should already be legal
    expect(reconciliationIssues(s, "KC").filter((i) => i.kind === "position")).toHaveLength(0);
  }, 60_000);

  it("reports being over the cap", () => {
    const s = league();
    s.teams["KC"]!.cap.total = 1;
    const issues = reconciliationIssues(s, "KC");
    expect(issues.some((i) => i.kind === "cap")).toBe(true);
    expect(isReconciled(s, "KC")).toBe(false);
  }, 60_000);

  it("reports being over the roster limit", () => {
    const s = league();
    // move plenty of free agents onto the roster
    let added = 0;
    for (const p of Object.values(s.players)) {
      if (added >= ROSTER_SIZE + 10) break;
      if (p.free_agent && !p.retired) {
        p.free_agent = false;
        p.nfl_team = "KC";
        added++;
      }
    }
    expect(reconciliationIssues(s, "KC").some((i) => i.kind === "roster")).toBe(true);
  }, 60_000);

  it("reports every violation at once, not one at a time", () => {
    const s = league();
    s.teams["KC"]!.cap.total = 1;
    for (const p of rosterOf(s, "KC").filter((x) => x.position === "QB")) {
      p.nfl_team = "FA";
      p.free_agent = true;
    }
    const kinds = new Set(reconciliationIssues(s, "KC").map((i) => i.kind));
    expect(kinds.has("cap")).toBe(true);
    expect(kinds.has("position")).toBe(true);
  }, 60_000);
});

describe("releasing a player", () => {
  it("costs the lesser of the two formulas", () => {
    const s = league();
    const p = rosterOf(s, "KC").find((x) => x.contract)!;
    const annual = p.contract!.cap_hit_by_year[0] ?? 0;
    p.contract!.years_remaining = 5;
    // five years at twenty percent each is capped at eighty percent of a year
    expect(releasePenalty(p)).toBeCloseTo(Math.round(annual * 0.8 * 10) / 10, 5);
    p.contract!.years_remaining = 1;
    expect(releasePenalty(p)).toBeCloseTo(Math.round(annual * 0.2 * 10) / 10, 5);
  }, 60_000);

  it("puts the player back in the pool and the penalty on the cap", () => {
    const s = league();
    const p = rosterOf(s, "KC").find((x) => x.contract && x.overall > 0)!;
    const before = s.teams["KC"]!.cap.used;
    const penalty = releasePenalty(p);
    applyRelease(s, "KC", p.id);
    expect(s.players[p.id]!.free_agent).toBe(true);
    expect(s.players[p.id]!.nfl_team).toBe("FA");
    expect(s.teams["KC"]!.cap.used).toBeCloseTo(before + penalty, 5);
  }, 60_000);

  it("locks a player signed in this free agency for the year", () => {
    const s = league();
    const p = rosterOf(s, "KC")[0]!;
    s.freeAgencyEvent!.signed.push({
      playerId: p.id,
      teamCode: "KC",
      salary: 5,
      years: 3,
      round: 1,
    });
    const check = checkRelease(s, "KC", p.id);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/locked/i);
  }, 60_000);
});

describe("emergency players", () => {
  it("fills only the holes, and only as far as the minimum", () => {
    const s = league();
    for (const p of rosterOf(s, "KC").filter((x) => x.position === "QB")) {
      p.nfl_team = "FA";
      p.free_agent = true;
    }
    const made = fillPositionalGaps(s, "KC");
    expect(made).toBeGreaterThan(0);
    expect(reconciliationIssues(s, "KC").some((i) => i.kind === "position")).toBe(false);
  }, 60_000);

  it("makes them worthless, so they are a last resort and not a strategy", () => {
    const s = league();
    for (const p of rosterOf(s, "KC").filter((x) => x.position === "K")) {
      p.nfl_team = "FA";
      p.free_agent = true;
    }
    fillPositionalGaps(s, "KC");
    const emergency = rosterOf(s, "KC").filter((p) => p.id.startsWith("emg_"));
    expect(emergency.length).toBeGreaterThan(0);
    for (const p of emergency) {
      expect(p.overall).toBe(0);
      expect(p.contract?.cap_hit_by_year[0]).toBe(0);
      expect(p.contract?.years_remaining).toBe(1);
    }
  }, 60_000);
});

describe("the CPU getting legal", () => {
  it("reconciles a team that is over the cap", () => {
    const s = league();
    s.teams["BUF"]!.cap.total = Math.max(1, capUsed(s, "BUF") - 40);
    expect(isReconciled(s, "BUF")).toBe(false);
    reconcileCpuTeam(s, "BUF");
    expect(reconciliationIssues(s, "BUF").some((i) => i.kind === "position")).toBe(false);
  }, 120_000);

  it("always leaves enough bodies to field a team", () => {
    const s = league();
    for (const p of rosterOf(s, "BUF")) {
      p.nfl_team = "FA";
      p.free_agent = true;
    }
    reconcileCpuTeam(s, "BUF");
    expect(reconciliationIssues(s, "BUF").some((i) => i.kind === "position")).toBe(false);
  }, 120_000);
});
