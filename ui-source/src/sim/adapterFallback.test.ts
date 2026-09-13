import { describe, expect, it, vi } from "vitest";

import { HybridSimulationService } from "./HybridSimulationService.ts";

/**
 * Every real-backed method used to retry the adapter on every call. A season
 * is ~20 `simulateWeek` round-trips, so playing with no adapter running — the
 * standalone single-file build's normal state — filled the console with
 * hundreds of identical ERR_CONNECTION_REFUSED lines. One refusal is now
 * remembered for a cooldown.
 */
function refusingFetch() {
  return vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
}

describe("adapter fallback", () => {
  it("stops calling the adapter after it refuses, and still returns real data", async () => {
    const fetchSpy = refusingFetch();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const sim = new HybridSimulationService();
      const codes = ["KC", "BUF"];

      const first = await sim.generateSchedule(1, codes);
      const callsAfterFirst = fetchSpy.mock.calls.length;
      expect(callsAfterFirst).toBeGreaterThan(0); // it did try once
      expect(first.length).toBeGreaterThan(0); // and fell back to Mock

      for (let i = 0; i < 5; i++) await sim.generateSchedule(1, codes);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // no further attempts
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the fallback result identical to Mock's own", async () => {
    vi.stubGlobal("fetch", refusingFetch());
    try {
      const sim = new HybridSimulationService();
      const pool = await sim.generateInitialPool(7, "realRosters");
      expect(pool.length).toBeGreaterThan(0);
      expect(pool.every((p) => typeof p.overall === "number")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
