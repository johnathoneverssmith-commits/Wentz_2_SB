import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { COACH_ROLES } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { beginDraft } from "@/state/rules.ts";
import { beginCoachingDraft, runAiCoachingPicks } from "@/state/coachingDraft.ts";
import {
  defensiveComposite,
  offensiveComposite,
  rankBy,
  staffCards,
  staffComplete,
  staffOverall,
  STAFF_WEIGHTS,
} from "@/state/staffRatings.ts";

/**
 * Change 3 — what a staff is worth.
 *
 * Two questions with two different weightings: how good the staff is overall
 * (head coach triple, coordinators double) and how good it is on each side of
 * the ball (coordinator a third or two fifths, position coaches the rest).
 * The head coach is deliberately absent from both unit composites, so the
 * person already weighted most heavily overall is not counted a second time.
 */
function draftedLeague(): LeagueState {
  const s = createLeague(4321, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.stage = "fantasyDraft";
  beginDraft(s, "fantasy");
  s.stage = "coachingDraft";
  beginCoachingDraft(s);
  runAiCoachingPicks(s, new Set());
  return s;
}

/** Put a known rating on every job of one team. */
function setStaff(s: LeagueState, team: string, ratings: Partial<Record<string, number>>): void {
  for (const c of Object.values(s.coaches)) {
    const r = ratings[c.role];
    if (c.team === team && r != null) c.overall = r;
  }
}

describe("staff weighting", () => {
  it("weights the head coach triple and the coordinators double", () => {
    expect(STAFF_WEIGHTS.HC).toBe(3);
    expect(STAFF_WEIGHTS.OC).toBe(2);
    expect(STAFF_WEIGHTS.DC).toBe(2);
    for (const r of COACH_ROLES) {
      if (r === "HC" || r === "OC" || r === "DC") continue;
      expect(STAFF_WEIGHTS[r], r).toBe(1);
    }
  });

  it("averages a flat staff to its own rating", () => {
    const s = draftedLeague();
    const flat = Object.fromEntries(COACH_ROLES.map((r) => [r, 80]));
    setStaff(s, "KC", flat);
    expect(staffOverall(s, "KC")).toBe(80);
    expect(offensiveComposite(s, "KC")).toBe(80);
    expect(defensiveComposite(s, "KC")).toBe(80);
  }, 120_000);

  it("lets the head coach move the overall more than a position coach", () => {
    const s = draftedLeague();
    const flat = Object.fromEntries(COACH_ROLES.map((r) => [r, 70]));

    setStaff(s, "KC", { ...flat, HC: 90 });
    const withHc = staffOverall(s, "KC");
    setStaff(s, "KC", { ...flat, QB: 90 });
    const withQb = staffOverall(s, "KC");

    expect(withHc).toBeGreaterThan(withQb);
  }, 120_000);

  it("keeps the head coach out of the unit composites", () => {
    const s = draftedLeague();
    const flat = Object.fromEntries(COACH_ROLES.map((r) => [r, 70]));
    setStaff(s, "KC", { ...flat, HC: 99 });
    // a brilliant head coach does not make the offence or defence read better
    expect(offensiveComposite(s, "KC")).toBe(70);
    expect(defensiveComposite(s, "KC")).toBe(70);
  }, 120_000);

  it("weights the coordinator above any one position coach in its unit", () => {
    const s = draftedLeague();
    const flat = Object.fromEntries(COACH_ROLES.map((r) => [r, 70]));

    setStaff(s, "KC", { ...flat, OC: 90 });
    const withOc = offensiveComposite(s, "KC");
    setStaff(s, "KC", { ...flat, QB: 90 });
    const withQb = offensiveComposite(s, "KC");
    expect(withOc).toBeGreaterThan(withQb);

    setStaff(s, "KC", { ...flat, DC: 90 });
    const withDc = defensiveComposite(s, "KC");
    setStaff(s, "KC", { ...flat, DL: 90 });
    const withDl = defensiveComposite(s, "KC");
    expect(withDc).toBeGreaterThan(withDl);
  }, 120_000);

  it("reads a vacancy as a smaller staff, not as a zero", () => {
    const s = draftedLeague();
    setStaff(s, "KC", Object.fromEntries(COACH_ROLES.map((r) => [r, 80])));
    const full = staffOverall(s, "KC");
    // sack the trainer
    for (const c of Object.values(s.coaches)) {
      if (c.team === "KC" && c.role === "MED") c.team = null;
    }
    expect(staffComplete(s, "KC")).toBe(false);
    // still a staff of eighties, not an eighty-with-a-hole
    expect(staffOverall(s, "KC")).toBe(full);
  }, 120_000);
});

describe("league ranks", () => {
  it("fills every job on every team after the draft", () => {
    const s = draftedLeague();
    for (const team of Object.keys(s.teams)) {
      expect(staffComplete(s, team), team).toBe(true);
    }
  }, 120_000);

  it("ranks one per team, best first", () => {
    const s = draftedLeague();
    const cards = staffCards(s);
    expect(cards).toHaveLength(Object.keys(s.teams).length);
    const ranks = rankBy(cards, "overall");
    const best = [...cards].sort((a, b) => b.overall - a.overall)[0]!;
    expect(ranks.get(best.teamCode)).toBe(1);
  }, 120_000);

  it("gives tied staffs the same rank", () => {
    const s = draftedLeague();
    const flat = Object.fromEntries(COACH_ROLES.map((r) => [r, 75]));
    setStaff(s, "KC", flat);
    setStaff(s, "BUF", flat);
    const ranks = rankBy(staffCards(s), "overall");
    expect(ranks.get("KC")).toBe(ranks.get("BUF"));
  }, 120_000);
});
