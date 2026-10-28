import { describe, expect, it } from "vitest";

import { ActionError } from "../src/db.js";
import { requireStage } from "../src/phases.js";
import { STAGE_LABEL } from "@/state/stageMachine.ts";

/**
 * D7 at the door: a request that says which stage it was made for is the only
 * kind a stage-changing route will act on. (The database-backed halves — a
 * stale ready is refused, a doubled force-advance moves one stage — are in
 * reliability-audit.test.ts, and over real HTTP in dev/reliability-drill.ts.)
 */
describe("requireStage", () => {
  it.each([undefined, null, "", 3, {}, ["setup"]])("refuses %j as missing", (v) => {
    expect(() => requireStage(v)).toThrow(ActionError);
    try {
      requireStage(v);
    } catch (e) {
      expect((e as ActionError).status).toBe(400);
    }
  });

  it.each(["nonsense", "__proto__", "toString", "constructor"])("refuses the unknown stage %s", (v) => {
    expect(() => requireStage(v)).toThrow(ActionError);
  });

  it("accepts every stage the league can be in", () => {
    for (const stage of Object.keys(STAGE_LABEL)) expect(requireStage(stage)).toBe(stage);
  });
});
