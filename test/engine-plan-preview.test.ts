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
