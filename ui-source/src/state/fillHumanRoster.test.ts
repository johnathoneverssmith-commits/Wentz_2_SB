import { describe, expect, it } from "vitest";

import { createLeague, fillRosterGaps } from "./seed.ts";
import { ROSTER_SIZE, ROSTER_TEMPLATE } from "@/sim/roster-template.ts";

/**
 * The roster fill used to cut a GM's roster down to the CPU template — the
 * seventh receiver, a rookie punter drafted that week — and refill it with
 * players the GM never chose.
 */
describe("the roster fill on a GM's team", () => {
  it("keeps the GM's surplus at a position and never goes past 53", () => {
    const s = createLeague(1);
    const code = Object.keys(s.teams).find((c) => s.teams[c]!.controlledBy.kind !== "ai")!;
    const wrCap = ROSTER_TEMPLATE.find((r) => r.pos === "WR")!.count;
    const market = Object.values(s.players).filter((p) => p.free_agent && !p.retired && p.position === "WR");
    for (const p of market.slice(0, wrCap + 2)) {
      p.free_agent = false;
      p.nfl_team = code;
    }
    const wrs = () => Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired && p.position === "WR");
    const had = wrs().map((p) => p.id);
    expect(had.length).toBeGreaterThan(wrCap);

    fillRosterGaps(s);

    expect(wrs().map((p) => p.id)).toEqual(expect.arrayContaining(had));
    const roster = Object.values(s.players).filter((p) => p.nfl_team === code && !p.retired);
    expect(roster.length).toBeLessThanOrEqual(ROSTER_SIZE);
  });
});
