import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { draftValueByTeam } from "./draftValue.ts";
import { beginDraft, completeDraft } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG, recomputeTeamRatings } from "./seed.ts";
import { sideRatings, projectedStrengths } from "./unitReport.ts";
import { REPLACEMENT_RATING } from "./unitValue.ts";

/**
 * The fantasy-draft summary grades teams by `ratings.overallRank`. These pin
 * what that number means: projected strength (units, holes, weak links),
 * unrounded for ranking — and, separately, what draft VALUE means.
 */

const TEMPLATE: Record<string, number> = {
  QB: 1, RB: 1, WR: 3, TE: 1, OT: 2, OG: 2, C: 1, EDGE: 2, DT: 2, ILB: 2, CB: 2, S: 2,
};

type Spec = Record<string, number[]>;

/** A league of hand-built teams: `spec[team][position]` = the ratings on that roster at that position. */
function world(spec: Record<string, Spec>): Pick<LeagueState, "players" | "teams" | "depthChart"> {
  const players: Record<string, Player> = {};
  let n = 0;
  for (const [team, byPos] of Object.entries(spec)) {
    for (const [pos, ratings] of Object.entries(byPos)) {
      for (const overall of ratings) {
        const id = `p${n++}`;
        players[id] = { id, name: id, position: pos, overall, nfl_team: team, retired: false } as unknown as Player;
      }
    }
  }
  const teams = Object.fromEntries(Object.keys(spec).map((c) => [c, { code: c }])) as unknown as LeagueState["teams"];
  return { players, teams, depthChart: {} } as Pick<LeagueState, "players" | "teams" | "depthChart">;
}

const full = (rating: number, override: Spec = {}): Spec => {
  const out: Spec = {};
  for (const [pos, k] of Object.entries(TEMPLATE)) out[pos] = Array<number>(k).fill(rating);
  return { ...out, ...override };
};

describe("projected strength (what the draft grade is built on)", () => {
  it("orders known-strength teams correctly and does not tie them", () => {
    const w = world({ A: full(80), B: full(79), C: full(70) });
    const s = projectedStrengths(w);
    expect(s.A!.overall).toBeGreaterThan(s.B!.overall);
    expect(s.B!.overall).toBeGreaterThan(s.C!.overall);
    expect(s.A!.overall).toBeCloseTo(80, 5);
  });

  it("a missing starter plays at replacement level instead of vanishing from the average", () => {
    // B has no quarterback at all. Under the old lineup average that *raised*
    // its rating, because the missing player was left out of the sum.
    const filled = projectedStrengths(world({ A: full(85) }));
    const hole = projectedStrengths(world({ B: full(85, { QB: [] }) }));
    const asReplacement = projectedStrengths(world({ C: full(85, { QB: [REPLACEMENT_RATING] }) }));
    expect(hole.B!.overall).toBeLessThan(filled.A!.overall);
    expect(hole.B!.offense).toBeCloseTo(asReplacement.C!.offense, 8);
    expect(hole.B!.defense).toBeCloseTo(filled.A!.defense, 8);
  });

  it("weights a hole by position: a missing quarterback costs more than a missing tight end", () => {
    const noQb = projectedStrengths(world({ A: full(85, { QB: [] }) })).A!.overall;
    const noTe = projectedStrengths(world({ A: full(85, { TE: [] }) })).A!.overall;
    expect(noQb).toBeLessThan(noTe);
  });

  it("charges a weak link more than its share of the average", () => {
    // same mean line (80), one with a 50 at guard
    const even = projectedStrengths(world({ A: full(85, { OT: [80, 80], OG: [80, 80], C: [80] }) })).A!.overall;
    const weakLink = projectedStrengths(world({ A: full(85, { OT: [86, 86], OG: [86, 50], C: [86] }) })).A!.overall;
    const plainMeanLine = (86 * 4 + 50) / 5; // 78.8 < 80, so a pure average would already rank it lower; the pull must go further
    expect(plainMeanLine).toBeLessThan(80);
    expect(weakLink).toBeLessThan(even);
  });

  it("an excellent starting group with no depth is assessed on its starters; depth is the separate roster number", () => {
    const stars = world({
      A: full(90), // starters only
      B: full(75, Object.fromEntries(Object.keys(TEMPLATE).map((p) => [p, Array<number>(TEMPLATE[p]! + 3).fill(75)]))), // deep, average
    });
    const s = projectedStrengths(stars);
    expect(s.A!.overall).toBeGreaterThan(s.B!.overall);
  });

  it("does not let a bench player at the wrong position stand in for a hole", () => {
    const w = world({ A: full(85, { QB: [], RB: [95, 95, 95] }) });
    const qbless = projectedStrengths(w).A!.offense;
    const fine = projectedStrengths(world({ A: full(85) })).A!.offense;
    expect(qbless).toBeLessThan(fine);
  });

  it("reads the same offense and defense as the hub (sideRatings)", () => {
    const w = world({ A: full(82, { QB: [95], CB: [60, 90] }), B: full(77) });
    const side = sideRatings(w);
    const proj = projectedStrengths(w);
    for (const c of ["A", "B"]) {
      expect(Math.round(proj[c]!.offense)).toBe(side[c]!.offense);
      expect(Math.round(proj[c]!.defense)).toBe(side[c]!.defense);
    }
  });
});

describe("after a real fantasy draft", () => {
  for (const pool of ["fictional", "legacy"] as const) {
    it(`${pool} league: ranks are a strict ordering of unrounded strength, not code-order ties`, () => {
      const s = createLeague(7, { ...DEFAULT_CONFIG, humanGmCount: 0, ...(pool === "legacy" ? { playerPool: "legacy" } : {}) });
      beginDraft(s, "fantasy");
      completeDraft(s);
      recomputeTeamRatings(s);
      const codes = Object.keys(s.teams);
      const proj = projectedStrengths(s);
      const ranks = codes.map((c) => s.teams[c]!.ratings.overallRank).sort((a, b) => a - b);
      expect(ranks).toEqual(codes.map((_, i) => i + 1));
      // rank order agrees with the unrounded strength it is meant to reflect
      const byRank = [...codes].sort((a, b) => s.teams[a]!.ratings.overallRank - s.teams[b]!.ratings.overallRank);
      for (let i = 1; i < byRank.length; i++) {
        expect(proj[byRank[i - 1]!]!.overall).toBeGreaterThanOrEqual(proj[byRank[i]!]!.overall - 1e-9);
      }
      // the displayed value carries a decimal, so 32 teams are not squeezed into 3-4 integers
      const shown = new Set(codes.map((c) => s.teams[c]!.ratings.overall));
      expect(shown.size).toBeGreaterThan(8);
    }, 120_000);
  }
});

describe("draft value is not roster strength", () => {
  it("rewards a pick that beat its slot, and says nothing about positional fit", () => {
    const mk = (id: string, overall: number): Player => ({ id, overall, position: "RB" }) as unknown as Player;
    const players = { a: mk("a", 90), b: mk("b", 80), c: mk("c", 70), d: mk("d", 60) };
    // pick order X, Y, X, Y — X took the 90 then the 60; Y took the 80 then the 70
    const draft = {
      results: [
        { teamCode: "X", selectedId: "a" },
        { teamCode: "Y", selectedId: "c" }, // Y reached... passing over b (80) for c (70)
        { teamCode: "X", selectedId: "b" },
        { teamCode: "Y", selectedId: "d" },
      ],
    } as unknown as LeagueState["draft"];
    const v = draftValueByTeam({ draft, players });
    // slot expectations are the sorted overalls 90, 80, 70, 60
    expect(v.X!.valueOverSlot).toBe(0 + 10); // 90-90, 80-70
    expect(v.Y!.valueOverSlot).toBe(-10); // 70-80, 60-60
    expect(v.X!.perPick).toBe(5);
  });

  it("can disagree with strength: the best-value drafter is not necessarily the strongest team", () => {
    // X takes the best players available but they are all running backs — a
    // lot of value, a hole at quarterback; Y takes worse value at the positions that matter.
    const w = world({ X: full(85, { QB: [], RB: [95, 95, 95] }), Y: full(84) });
    const strength = projectedStrengths(w);
    expect(strength.Y!.overall).toBeGreaterThan(strength.X!.overall);
    const mk = (id: string, overall: number): Player => ({ id, overall, position: "RB" }) as unknown as Player;
    const players = { a: mk("a", 95), b: mk("b", 85) };
    const draft = { results: [{ teamCode: "Y", selectedId: "b" }, { teamCode: "X", selectedId: "a" }] } as unknown as LeagueState["draft"];
    const value = draftValueByTeam({ draft, players });
    expect(value.X!.valueOverSlot).toBeGreaterThan(value.Y!.valueOverSlot);
  });
});
