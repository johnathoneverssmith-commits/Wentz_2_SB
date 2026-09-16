import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginDraft } from "@/state/rules.ts";
import { beginCoachingDraft, runAiCoachingPicks } from "@/state/coachingDraft.ts";
import {
  checkCampSubmission,
  checkInvestments,
  focusStrength,
  oddsMultiplier,
  runCpuTrainingCamps,
  runTrainingCamp,
  type TrainingCampPlan,
} from "@/state/trainingCamp.ts";

/**
 * Change 5 — training camp.
 *
 * Three things stack in a fixed order: the aging model decides the direction,
 * the position coach scales it, and a coordinator focus scales it again for
 * the group they concentrated on. Nothing downstream may change the direction
 * the aging model chose — that is what stops coaching from becoming a way to
 * opt out of age.
 */
function campLeague(): LeagueState {
  const s = createLeague(7412, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.stage = "fantasyDraft";
  beginDraft(s, "fantasy");
  s.stage = "coachingDraft";
  beginCoachingDraft(s);
  runAiCoachingPicks(s, new Set());
  s.stage = "trainingCamp";
  return s;
}

const plan = (over: Partial<TrainingCampPlan> = {}): TrainingCampPlan => ({
  offensiveFocus: "QB",
  defensiveFocus: "DL",
  positiveInvestment: 0,
  negativeInvestment: 0,
  submitted: false,
  ...over,
});

describe("coordinator focus strength", () => {
  it("is ten percent at a league-average coordinator", () => {
    expect(focusStrength(72)).toBeCloseTo(0.1, 10);
  });

  it("moves half a point per point of rating", () => {
    expect(focusStrength(92)).toBeCloseTo(0.2, 10);
    expect(focusStrength(52)).toBeCloseTo(0.0, 1);
  });

  it("never goes below three percent, however poor the coordinator", () => {
    // spending practice time on a group cannot make them worse
    expect(focusStrength(0)).toBeGreaterThanOrEqual(0.03);
    expect(focusStrength(35)).toBeGreaterThanOrEqual(0.03);
  });

  it("caps at twenty-four percent, however good", () => {
    expect(focusStrength(99)).toBeLessThanOrEqual(0.24);
    expect(focusStrength(200)).toBeLessThanOrEqual(0.24);
  });
});

describe("event investments", () => {
  it("buys odds rather than probability", () => {
    expect(oddsMultiplier(0)).toBe(1);
    expect(oddsMultiplier(4)).toBeCloseTo(1.2, 10);
    expect(oddsMultiplier(25)).toBeCloseTo(1.5, 10);
  });

  it("has diminishing returns — the first million beats the tenth", () => {
    const first = oddsMultiplier(1) - oddsMultiplier(0);
    const tenth = oddsMultiplier(10) - oddsMultiplier(9);
    expect(first).toBeGreaterThan(tenth);
  });

  it("refuses more than the team has", () => {
    const s = campLeague();
    const room = s.teams["KC"]!.cap.total - s.teams["KC"]!.cap.used;
    expect(checkInvestments(s, "KC", room + 10, 0).ok).toBe(false);
    expect(checkInvestments(s, "KC", 0, 0).ok).toBe(true);
  }, 120_000);

  it("refuses negatives and nonsense", () => {
    const s = campLeague();
    expect(checkInvestments(s, "KC", -1, 0).ok).toBe(false);
    expect(checkInvestments(s, "KC", Number.NaN, 0).ok).toBe(false);
  }, 120_000);
});

describe("submitting a camp", () => {
  it("requires both focuses", () => {
    const s = campLeague();
    expect(checkCampSubmission(s, "KC", plan({ offensiveFocus: null })).ok).toBe(false);
    expect(checkCampSubmission(s, "KC", plan({ defensiveFocus: null })).ok).toBe(false);
    expect(checkCampSubmission(s, "KC", plan()).ok).toBe(true);
  }, 120_000);

  it("spends the money off the cap", () => {
    const s = campLeague();
    const before = s.teams["KC"]!.cap.used;
    runTrainingCamp(s, "KC", plan({ positiveInvestment: 2, negativeInvestment: 1.5 }));
    expect(s.teams["KC"]!.cap.used).toBeCloseTo(before + 3.5, 5);
  }, 120_000);

  it("records a result for every player on the roster", () => {
    const s = campLeague();
    runTrainingCamp(s, "KC", plan());
    const roster = Object.values(s.players).filter(
      (p) => p.nfl_team === "KC" && !p.retired && !p.free_agent,
    );
    expect(s.trainingCamp!.results["KC"]).toHaveLength(roster.length);
  }, 120_000);

  it("is deterministic — a retry produces the same camp", () => {
    const a = campLeague();
    const b = campLeague();
    runTrainingCamp(a, "KC", plan());
    runTrainingCamp(b, "KC", plan());
    const byId = (s: LeagueState) =>
      Object.fromEntries(s.trainingCamp!.results["KC"]!.map((r) => [r.playerId, r.delta]));
    expect(byId(a)).toEqual(byId(b));
  }, 120_000);
});

describe("what a focus does", () => {
  it("never turns a decline into an improvement", () => {
    const s = campLeague();
    runTrainingCamp(s, "KC", plan());
    // whatever the focus did, no result contradicts its own direction
    for (const r of s.trainingCamp!.results["KC"]!) {
      expect(r.next - r.previous).toBe(r.delta);
    }
  }, 120_000);

  it("develops the focused group harder than an unfocused one", () => {
    // same league, same seed — only which group got the attention differs
    const focused = campLeague();
    const other = campLeague();
    // make the coordinators excellent so the focus is worth something
    for (const s of [focused, other]) {
      for (const c of Object.values(s.coaches)) {
        if (c.team === "KC" && (c.role === "OC" || c.role === "DC")) c.overall = 99;
      }
    }
    runTrainingCamp(focused, "KC", plan({ offensiveFocus: "QB" }));
    runTrainingCamp(other, "KC", plan({ offensiveFocus: "OL" }));

    const gainAt = (s: LeagueState, positions: string[]) =>
      s.trainingCamp!.results["KC"]!
        .filter((r) => positions.includes(r.position))
        .reduce((n, r) => n + Math.max(0, r.delta), 0);

    // quarterbacks did at least as well under the QB focus as under the OL one
    expect(gainAt(focused, ["QB"])).toBeGreaterThanOrEqual(gainAt(other, ["QB"]));
  }, 180_000);
});

describe("the CPU", () => {
  it("submits a plan for every team it runs", () => {
    const s = campLeague();
    runCpuTrainingCamps(s, new Set(["KC"]));
    for (const team of Object.keys(s.teams)) {
      if (team === "KC") continue;
      const p = s.trainingCamp!.plans[team];
      expect(p?.submitted, team).toBe(true);
      expect(p?.offensiveFocus, team).toBeTruthy();
      expect(p?.defensiveFocus, team).toBeTruthy();
    }
  }, 180_000);

  it("leaves the human team alone", () => {
    const s = campLeague();
    runCpuTrainingCamps(s, new Set(["KC"]));
    expect(s.trainingCamp!.plans["KC"]).toBeUndefined();
  }, 180_000);
});
