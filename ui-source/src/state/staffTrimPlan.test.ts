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

/**
 * Over the limit by one, the staff cut the third-round corner signed that
 * same week — the lowest-rated of seven, so "surplus" — and left $2.1M of his
 * bonus on the cap, keeping a 30-year-old on a one-year minimum deal.
 */
describe("the surplus body", () => {
  it("is the veteran on a minimum deal, not the rookie just signed", () => {
    const s = createLeague(45, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
    fillRosterGaps(s);
    const cbs = rosterOf(s, "GB").filter((p) => p.position === "CB");
    const pool = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.position === "CB");
    // seven corners plus enough spares to be one over
    const add = (over: Partial<(typeof pool)[number]>) => {
      const p = pool.shift()!;
      Object.assign(p, { free_agent: false, nfl_team: "GB", ...over });
      return p;
    };
    const vet = add({
      age: 30,
      overall: 61,
      potential: 61,
      contract: { years_remaining: 1, cap_hit_by_year: [1], guaranteed: 0 } as never,
    });
    const rookie = add({
      age: 22,
      overall: 58,
      potential: 74,
      contract: { years_remaining: 4, cap_hit_by_year: [1.9, 1.9, 1.9, 1.9], guaranteed: 1.9 } as never,
    });
    while (rosterOf(s, "GB").length <= 53) add({ contract: { years_remaining: 1, cap_hit_by_year: [1], guaranteed: 0 } as never });
    expect(cbs.length).toBeGreaterThan(0);

    const cut = planStaffTrim(s, "GB").map((p) => p.id);
    expect(cut).not.toContain(rookie.id);
    expect(cut).toContain(vet.id);
  });
});
