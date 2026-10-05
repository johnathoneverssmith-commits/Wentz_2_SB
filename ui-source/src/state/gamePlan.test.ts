import { describe, expect, it } from "vitest";

import { roster, teamList } from "../../../src/engine/roster.js";
import { simulateGame } from "../../../src/engine/sim.js";

import { aiGamePlan, cleanPlan, DEFAULT_PLAN, gamePlanFor, isDefaultPlan } from "./gamePlan";

describe("AI game plans", () => {
  it("every CPU team's plan is valid, deterministic, and some are not the standard plan", () => {
    const codes = teamList();
    const plans = codes.map((c) => aiGamePlan(c, 2027));
    for (const p of plans) {
      expect(cleanPlan(p)).toEqual(p);
      expect(p.p11 + p.p12 + p.p13).toBe(100);
    }
    expect(plans.some((p) => !isDefaultPlan(p))).toBe(true);
    expect(codes.map((c) => aiGamePlan(c, 2027))).toEqual(plans);
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

  it("the CPU philosophies leave league scoring where it was", () => {
    const teams = teamList();
    const play = (plans: boolean) => {
      let pts = 0, g = 0, att = 0, rush = 0;
      for (let i = 0; i < 140; i++) {
        const h = teams[i % 32]!, a = teams[(i * 7 + 5) % 32]!;
        if (h === a) continue;
        const game = simulateGame(5500 + i, h, a, {
          homeRoster: roster(h),
          awayRoster: roster(a),
          overtime: "nfl",
          ...(plans ? { homePlan: aiGamePlan(h, 2027), awayPlan: aiGamePlan(a, 2027) } : {}),
        });
        for (const side of [0, 1]) {
          const st = game.teams[side]!.s as Record<string, number>;
          pts += game.score[side]!; g++;
          att += st.pass_att ?? 0; rush += st.rush_att ?? 0;
        }
      }
      return { pts: pts / g, pass: att / (att + rush) };
    };
    const base = play(false);
    const ai = play(true);
    expect(Math.abs(ai.pts - base.pts) / base.pts).toBeLessThan(0.05);
    expect(Math.abs(ai.pass - base.pass)).toBeLessThan(0.03);
  }, 240_000);
});
