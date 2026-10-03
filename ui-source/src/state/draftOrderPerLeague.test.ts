import { describe, expect, it } from "vitest";

import { beginDraft } from "./rules.ts";
import { createLeague, DEFAULT_CONFIG } from "./seed.ts";

/**
 * The randomized fantasy draft order was seeded on the year alone, so every
 * league ever created drew the same order and the same team picked first.
 */
describe("fantasy draft order", () => {
  it("is different in different leagues, and the same in one league", () => {
    const first = (seed: number): string[] => {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, draftOrder: "randomized" });
      beginDraft(s, "fantasy");
      return s.draft!.pickOrder.slice(0, 32);
    };
    const orders = [11, 22, 33, 44, 55].map(first);
    const firstPicks = new Set(orders.map((o) => o[0]));
    expect(firstPicks.size, "five leagues, five first picks").toBeGreaterThan(1);
    expect(new Set(orders.map((o) => o.join(","))).size).toBe(orders.length);
    // a league keeps its own order across a reload
    expect(first(11)).toEqual(orders[0]);
  });
});
