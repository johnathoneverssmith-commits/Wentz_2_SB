import { describe, expect, it } from "vitest";

import { HOW_BY_ROUTE, HOW_IT_WORKS, topicsFor } from "./howItWorks.ts";
import { DRAFT_ROUNDS } from "./draftPicks.ts";
import { FA_ROUNDS_MAX } from "./rules.ts";
import { FIRE_BELOW } from "./hotSeat.ts";

/**
 * "How it works" is documentation that has to stay true. These pin what can be
 * pinned: every topic the app promises exists with text, every screen's topics
 * resolve, and the figures that are constants are the ones the text states.
 */
const ALL = ["drafts", "freeAgency", "trades", "tradeValue", "development", "regression", "injuries", "recovery", "gameSim", "strategyEffects", "awards", "unitGrades", "playoffOdds", "gmFiring", "coachingEffects"];

describe("how it works", () => {
  it("covers every system the app explains", () => {
    expect(HOW_IT_WORKS.map((t) => t.id).sort()).toEqual([...ALL].sort());
    for (const t of HOW_IT_WORKS) {
      expect(t.title.length, t.id).toBeGreaterThan(2);
      expect(t.sections.length, t.id).toBeGreaterThan(0);
      for (const sec of t.sections) expect(sec.body.join(" ").length, `${t.id}/${sec.heading}`).toBeGreaterThan(40);
    }
  });

  it("every screen's topics exist, and every topic is shown somewhere", () => {
    const shown = new Set<string>();
    for (const [route, ids] of Object.entries(HOW_BY_ROUTE)) {
      expect(topicsFor(route).length, route).toBe(ids.length);
      ids.forEach((i) => shown.add(i));
    }
    for (const id of ALL) expect(shown.has(id), `${id} is never shown`).toBe(true);
  });

  it("states the figures the game actually uses", () => {
    const text = (id: string) => JSON.stringify(HOW_IT_WORKS.find((t) => t.id === id));
    expect(text("drafts")).toContain(`${DRAFT_ROUNDS} rounds`);
    expect(text("freeAgency")).toContain(`${FA_ROUNDS_MAX} rounds`);
    expect(text("gmFiring")).toContain(`below ${FIRE_BELOW} is fired`);
  });
});
