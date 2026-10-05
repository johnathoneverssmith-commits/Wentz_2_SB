import { describe, expect, it } from "vitest";

import { aiGamePlan, cleanPlan, DEFAULT_PLAN, gamePlanFor } from "./gamePlan";

describe("game plans by team", () => {
  it("a CPU team's plan is valid and the same every time", () => {
    for (const c of ["KC", "BUF", "DAL", "GB", "SF", "NE"]) {
      const p = aiGamePlan(c, 2027);
      expect(cleanPlan(p)).toEqual(p);
      expect(aiGamePlan(c, 2027)).toEqual(p);
    }
  });

  it("a human's plan is theirs and a CPU team's is derived", () => {
    const s = {
      season: 2027,
      teams: { KC: { controlledBy: { kind: "human", gmId: "g" } }, BUF: { controlledBy: { kind: "ai" } } },
      gamePlans: { KC: { ...DEFAULT_PLAN, blitz: 40 }, BUF: { ...DEFAULT_PLAN, blitz: 99 } },
    } as never;
    expect(gamePlanFor(s, "KC").blitz).toBe(40);
    // the saved BUF plan is ignored: it isn't a human's team
    expect(gamePlanFor(s, "BUF")).toEqual(aiGamePlan("BUF", 2027));
  });
});
