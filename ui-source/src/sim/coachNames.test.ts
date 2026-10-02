import { expect, it } from "vitest";

import { MockSimulationService } from "./MockSimulationService.ts";

/** A coaching draft offered two "Tyler Lockett"s, a QB coach and a line coach. */
it("no two coaches on the market share a name", () => {
  for (const seed of [1, 777, 4242]) {
    // the real staffs may repeat a name (one man, two jobs); nobody invented may
    const names = new MockSimulationService()
      .generateCoachMarket(seed)
      .filter((c) => c.team == null)
      .map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  }
});
