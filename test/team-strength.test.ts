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

    expect(strengthIndex(lifted).offense).toBeGreaterThan(strengthIndex(base).offense);
    // and a receiver does not make the defense better
    expect(strengthIndex(lifted).defense).toBeCloseTo(strengthIndex(base).defense, 10);
  });

  it("separates the league's teams, on both sides of the ball", () => {
    for (const side of ["offense", "defense"] as const) {
      const xs = [...NFL_TEAMS].map((c) => strengthIndex(roster(c))[side]);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
      // a channel with no spread would be a no-op dressed as a mechanism
      expect(sd, side).toBeGreaterThan(0.5);
      expect(Math.max(...xs) - Math.min(...xs), side).toBeGreaterThan(2);
    }
  });

  it("does not make a team's offense and defense the same number", () => {
    // the whole point of the split: if these moved together, a matchup would
    // be a mirror again and margins would blow out
    const gaps = [...NFL_TEAMS].map((c) => {
      const ix = strengthIndex(roster(c));
      return ix.offense - ix.defense;
    });
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread).toBeGreaterThan(1);
  });
});

describe("the shift", () => {
  const ix = (offense: number, defense: number) => ({ offense, defense });

  it("is zero between equals", () => {
    expect(strengthShift(ix(75, 75), ix(75, 75), "complete")).toBe(0);
    expect(strengthShift(ix(80, 60), ix(60, 80), "complete")).toBe(0);
  });

  it("helps the better offense and hurts it on sacks", () => {
    // signs are from the offense's side: completing more, sacked less
    const good = ix(80, 70);
    const weakD = ix(70, 70);
    expect(strengthShift(good, weakD, "complete")).toBeGreaterThan(0);
    expect(strengthShift(good, weakD, "sack")).toBeLessThan(0);
    expect(strengthShift(good, weakD, "rushYards")).toBeGreaterThan(0);
  });

  it("reads this offense against that defense, not team against team", () => {
    // a team with a great offense and a poor defense should still move the
    // ball against a poor defense; a team-wide index would cancel it out
    const lopsided = ix(85, 65); // team mean 75
    const average = ix(75, 75); // same team mean
    expect(strengthShift(lopsided, average, "complete")).toBeGreaterThan(0);
  });

  it("scales with the fitted constant", () => {
    const edge = strengthShift(ix(80, 0), ix(0, 70), "complete");
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
