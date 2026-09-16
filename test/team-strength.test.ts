import { describe, expect, it } from "vitest";

import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { Roster, roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { strengthIndex, strengthShift, TEAM_STRENGTH_SCALE } from "../src/engine/team-strength.js";

/**
 * The team-strength channel: what the modelled families cannot see.
 *
 * The properties here are the ones that make it safe to add a fitted channel
 * to a calibrated layer — it must not move the league average, and it must
 * not touch the path §22 validates.
 */
describe("the strength index", () => {
  it("reads the whole roster, not just the starters", () => {
    // A better backup makes a better team. If this did not hold, the channel
    // would be measuring what the modelled families already read.
    //
    // Two fresh rosters rather than one mutated in place: the index is
    // memoised per roster object, so editing a player under a live one would
    // be testing the cache instead of the calculation.
    const players = [...roster("KC").depth.values()].flat();
    const base = new Roster("KC", players.map((p) => ({ ...p })));
    const lifted = new Roster(
      "KC",
      players.map((p) => ({ ...p })),
    );
    const wr = lifted.depth.get("WR")!;
    expect(wr.length).toBeGreaterThan(1);
    wr[1]!.overall = Math.min(99, wr[1]!.overall + 20);

    expect(strengthIndex(lifted)).toBeGreaterThan(strengthIndex(base));
  });

  it("separates the league's teams", () => {
    const xs = [...NFL_TEAMS].map((c) => strengthIndex(roster(c)));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    // a channel with no spread would be a no-op dressed as a mechanism
    expect(sd).toBeGreaterThan(0.5);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });
});

describe("the shift", () => {
  it("is zero between equals, and symmetric", () => {
    expect(strengthShift(75, 75, "complete")).toBe(0);
    expect(strengthShift(80, 70, "complete")).toBeCloseTo(-strengthShift(70, 80, "complete"), 10);
  });

  it("helps the better offense and hurts it on sacks", () => {
    // signs are from the offense's side: completing more, sacked less
    expect(strengthShift(80, 70, "complete")).toBeGreaterThan(0);
    expect(strengthShift(80, 70, "sack")).toBeLessThan(0);
    expect(strengthShift(80, 70, "rushYards")).toBeGreaterThan(0);
  });

  it("scales with the fitted constant", () => {
    const edge = strengthShift(80, 70, "complete");
    expect(edge / TEAM_STRENGTH_SCALE).toBeCloseTo(10 * 0.055, 10);
  });
});

describe("what it must not disturb", () => {
  /**
   * §22 validates `simulateGame(seed)` with no rosters at all. The channel is
   * gated on the rating layer, so that path has to be exactly what it was —
   * this is the guard that catches an ungated edit later.
   */
  it("leaves the pool-free game byte-identical", () => {
    let h = 0x811c9dc5;
    for (let i = 0; i < 60; i++) {
      const g = simulateGame(4000 + i);
      for (const s of [g.score[0]!, g.score[1]!]) {
        h ^= s | 0;
        h = Math.imul(h, 0x01000193);
      }
    }
    // the hash of the first 60 pool-free games, recorded before this channel
    // existed and unchanged by it
    expect((h >>> 0).toString(16)).toBe("77c0c2b9");
  }, 120_000);
});
