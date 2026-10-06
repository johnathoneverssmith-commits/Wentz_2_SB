import { describe, expect, it } from "vitest";

import { cleanPlan, isDefaultPlan, STRATEGY_PLANS } from "../src/engine/gameplan.js";
import { roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
/** A different set of seeds, to check a statistical assertion is not resting on the lucky ones: `SEED_SHIFT=1000 npx vitest run ...` */
const SHIFT = Number(process.env.SEED_SHIFT ?? "0");


/**
 * The plans CPU teams play (`STRATEGY_PLANS`): valid, and between them they leave
 * league scoring and pass rate where the standard plan has them. How each one
 * does on rosters that suit it, and on ones that don't, is
 * `analysis/42_strategy_tournament.ts`.
 */
describe("AI strategy plans", () => {
  it("every plan is valid, and all but balanced differ from the standard plan", () => {
    for (const [name, partial] of Object.entries(STRATEGY_PLANS)) {
      const p = cleanPlan(partial);
      expect(p.p11 + p.p12 + p.p13, name).toBe(100);
      expect(isDefaultPlan(p), name).toBe(name === "balanced");
    }
  });

  it("the CPU philosophies together leave league scoring where it was", () => {
    const teams = teamList();
    const names = Object.keys(STRATEGY_PLANS);
    const planOf = (t: string) => cleanPlan(STRATEGY_PLANS[names[teams.indexOf(t) % names.length]!]);
    const play = (plans: boolean) => {
      let pts = 0, g = 0, att = 0, rush = 0;
      for (let i = 0; i < 140; i++) {
        const h = teams[i % 32]!, a = teams[(i * 7 + 5) % 32]!;
        if (h === a) continue;
        const game = simulateGame(5500 + SHIFT + i, h, a, {
          homeRoster: roster(h),
          awayRoster: roster(a),
          overtime: "nfl",
          ...(plans ? { homePlan: planOf(h), awayPlan: planOf(a) } : {}),
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
    expect(Math.abs(ai.pts - base.pts) / base.pts).toBeLessThan(0.06);
    expect(Math.abs(ai.pass - base.pass)).toBeLessThan(0.03);
  }, 240_000);
});
