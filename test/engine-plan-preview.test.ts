import { expect, it } from "vitest";

import { cleanPlan } from "../src/engine/gameplan.js";
import { previewPlan } from "../src/engine/plan-preview.js";

/** The preseason lab: the same game both ways, so the standard plan against itself moves nothing. */
it("measures nothing for the standard plan, and is repeatable", () => {
  const same = previewPlan(5, "KC", "BUF", { talentScale: 1.5, overtime: "nfl" }, "home", cleanPlan({}), 30);
  expect(same.withPlan).toBe(same.standard);
  expect(same.marginDelta).toBe(0);
  expect(same.tooClose).toBe(false);

  const a = previewPlan(5, "KC", "BUF", { talentScale: 1.5, overtime: "nfl" }, "away", cleanPlan({ passRate: 12, blitz: 40 }), 30);
  const b = previewPlan(5, "KC", "BUF", { talentScale: 1.5, overtime: "nfl" }, "away", cleanPlan({ passRate: 12, blitz: 40 }), 30);
  expect(a).toEqual(b);
  expect(a.standard).toBeGreaterThan(0);
  expect(a.standard).toBeLessThan(100);
  expect(a.plusMinus).toBeGreaterThan(0);
});

it('keeps a plan estimate within sampling uncertainty of independently seeded actual games',async()=>{
 const {simulateGame}=await import('../src/engine/sim.js');
 const {roster}=await import('../src/engine/roster.js');
 const options={homeRoster:roster('KC'),awayRoster:roster('BUF'),overtime:'nfl' as const,talentScale:1.5};
 const plan=cleanPlan({passRate:12,blitz:40});const games=160;
 const estimate=previewPlan(91513,'KC','BUF',options,'home',plan,games);
 let wins=0;
 for(let i=0;i<games;i++){const g=simulateGame(700_003+i*3571,'KC','BUF',{...options,homePlan:plan});wins+=g.score[0]>g.score[1]?1:g.score[0]===g.score[1]?0.5:0;}
 const empirical=wins/games;
 // Two independent finite samples plus the existing margin-curve approximation.
 // This checks broad calibration, not an invented exact probability or improvement.
 const samplingBound=3*Math.sqrt(2*0.25/games)+0.03;
 expect(Math.abs(estimate.withPlan/100-empirical)).toBeLessThan(samplingBound);
},120_000);
