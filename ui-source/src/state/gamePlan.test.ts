import { describe, expect, it } from "vitest";

import { aiGamePlan, cleanPlan, DEFAULT_PLAN, gamePlanFor } from "./gamePlan";

const league = (teams: string[]) =>
  ({
    season: 2027,
    gms: [],
    teams: Object.fromEntries(teams.map((c) => [c, { controlledBy: { kind: "ai" } }])),
    aiGms: teams.map((c, i) => ({
      id: `g${i}`, name: `G${i}`, skill: 0, teamCode: c, hiredSeason: 2027, lastEmployedSeason: 2027, seasons: [],
      strategy: (["balanced", "pass_heavy", "run_heavy", "defense_heavy", "trenches_first", "high_floor"] as const)[i % 6],
    })),
  }) as never;

describe("game plans by team", () => {
  it("a CPU team's plan is valid, the same every time, and follows its GM's identity", () => {
    const s = league(["KC", "BUF", "DAL", "GB", "SF", "NE"]);
    for (const c of ["KC", "BUF", "DAL", "GB", "SF", "NE"]) {
      const p = aiGamePlan(s, c);
      expect(cleanPlan(p)).toEqual(p);
      expect(aiGamePlan(s, c)).toEqual(p);
    }
    // KC's GM is balanced and BUF's is pass-heavy
    expect(aiGamePlan(s, "BUF").passRate).toBeGreaterThan(aiGamePlan(s, "KC").passRate);
  });

  it("a human's plan is theirs and a CPU team's is derived", () => {
    const s = {
      season: 2027,
      gms: [],
      aiGms: [{ id: "g", name: "G", skill: 0, teamCode: "BUF", strategy: "pass_heavy", hiredSeason: 2027, lastEmployedSeason: 2027, seasons: [] }],
      teams: { KC: { controlledBy: { kind: "human", gmId: "g" } }, BUF: { controlledBy: { kind: "ai" } } },
      gamePlans: { KC: { ...DEFAULT_PLAN, blitz: 40 }, BUF: { ...DEFAULT_PLAN, blitz: 99 } },
    } as never;
    expect(gamePlanFor(s, "KC").blitz).toBe(40);
    // the saved BUF plan is ignored: it isn't a human's team
    expect(gamePlanFor(s, "BUF")).toEqual(aiGamePlan(s, "BUF"));
  });
});
