import { describe, expect, it, vi } from "vitest";

import { DEVELOPMENT_ROLES } from "@/domain";

import { HybridSimulationService } from "./HybridSimulationService.ts";

/**
 * The coach market has to contain every role the coaching draft fills,
 * whichever service built it.
 *
 * The engine adapter's `/coach-market` returns head coaches and
 * coordinators — the real 32 staffs plus generated ones — and nothing else.
 * The Mock market also builds the nine development roles, so every test,
 * which runs with no adapter, saw a complete market. A league created while
 * the adapter *was* running had no position coaches at all, and its coaching
 * draft stopped dead after round three: every team, human or CPU, was on the
 * clock with a QB-coach vacancy and a market of head coaches.
 *
 * This stubs the adapter as up, so the real-data path is what gets tested.
 */
function adapterUp() {
  const staff = (role: "HC" | "OC" | "DC", i: number) => ({
    role,
    name: `${role} ${i}`,
    previousTeam: "KC",
    gameManagement: 55,
    discipline: 55,
    aggression: 0.1,
    scheme: role === "OC" ? "west_coast" : "four_three",
    rating: 60,
    passBias: 0.1,
    blitzBias: 0.1,
  });
  const body = {
    real: Array.from({ length: 32 }, (_, i) => [staff("HC", i), staff("OC", i), staff("DC", i)]).flat(),
    generated: [staff("HC", 99), staff("OC", 99), staff("DC", 99)],
  };
  return vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as unknown as Response));
}

describe("the coach market", () => {
  it("includes every development role when the engine adapter is up", async () => {
    vi.stubGlobal("fetch", adapterUp());
    try {
      const market = await new HybridSimulationService().generateCoachMarket(5);
      for (const role of DEVELOPMENT_ROLES) {
        // enough for every team in a full 32-team league to fill the role
        expect(market.filter((c) => c.role === role).length, `${role} coaches`).toBeGreaterThanOrEqual(32);
      }
      // and the adapter's own staffs are still there
      expect(market.filter((c) => c.role === "HC").length).toBe(33);
      // no id collides between the two halves
      expect(new Set(market.map((c) => c.id)).size).toBe(market.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
