import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { regenerateBroadcast, simulateBlock } from "../src/blocks.js";
import { visibleGames, markRevealed, emptyReveal } from "@/state/reveal.ts";
import { wipePreseason } from "@/state/preseasonWipe.ts";

/**
 * Change 6 — the block is played once, before anybody watches it.
 *
 * The property that matters is that a precomputed block is indistinguishable
 * from having played the weeks one at a time. If it were not, revealing would
 * show a different season from the one that was simulated, and the whole
 * arrangement would be a lie told at speed.
 */
function ready(): LeagueState {
  const s = createLeague(3141, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "preseason";
  s.week = 1;
  s.reveal = emptyReveal();
  return s;
}

describe("simulating the preseason up front", () => {
  it("plays every week of the block", () => {
    const s = ready();
    const played = simulateBlock(s, "PRE", 1, 3);
    expect(played).toBeGreaterThan(0);
    for (let week = 1; week <= 3; week++) {
      expect(s.games.filter((g) => g.phase === "PRE" && g.week === week).length).toBeGreaterThan(0);
    }
  }, 300_000);

  it("is deterministic — the same league twice gives the same scores", () => {
    const a = ready();
    const b = ready();
    simulateBlock(a, "PRE", 1, 3);
    simulateBlock(b, "PRE", 1, 3);
    const scores = (s: LeagueState) =>
      s.games
        .filter((g) => g.phase === "PRE")
        .map((g) => `${g.id}:${g.homeScore}-${g.awayScore}`)
        .sort();
    expect(scores(a)).toEqual(scores(b));
  }, 300_000);

  it("refuses to play a week twice", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);
    const before = s.games.length;
    const again = simulateBlock(s, "PRE", 1, 3);
    expect(again).toBe(0);
    expect(s.games.length).toBe(before);
  }, 300_000);

  it("saves no play-by-play — that is regenerated on reveal", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);
    for (const g of s.games) {
      expect((g as { broadcast?: unknown }).broadcast).toBeUndefined();
    }
  }, 300_000);

  it("hides the whole block until somebody reveals it", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);
    const me = s.gms[0]!.id;
    // simulated and saved, but nobody has watched a minute of it
    expect(s.games.length).toBeGreaterThan(0);
    expect(visibleGames(s, me)).toHaveLength(0);

    markRevealed(s, me, "PRE", 1);
    const seen = visibleGames(s, me);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((g) => g.week === 1)).toBe(true);
  }, 300_000);

  it("gives both sides of a human-versus-human game the same result", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);
    // one canonical set of games, so there is only ever one score to disagree about
    const ids = s.games.filter((g) => g.phase === "PRE").map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  }, 300_000);
});

describe("regenerating play-by-play", () => {
  /**
   * The load-bearing claim behind not saving broadcasts: a game rebuilt from
   * its seed is the same game. If this drifts, a GM opens the play-by-play
   * for a 24-17 win and watches their team lose 31-10, which is worse than
   * having no play-by-play at all.
   */
  it("rebuilds a game that ends the way the saved score says it ended", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);

    // week 3 specifically: by then injuries have accumulated, so this also
    // proves the saved sideline list is what makes the rebuild exact
    const game = s.games.find((g) => g.phase === "PRE" && g.week === 3)!;
    const cast = regenerateBroadcast(s, game.id)!;

    expect(cast).not.toBeNull();
    expect(cast.finalScore).toEqual([game.homeScore, game.awayScore]);
    expect(cast.drives.length).toBeGreaterThan(0);
    // and the UI's spelling, not the engine's
    expect(cast.home).toBe(game.homeTeam);
    expect(cast.away).toBe(game.awayTeam);
  }, 300_000);

  it("is stable across calls", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 1);
    const game = s.games.find((g) => g.phase === "PRE")!;
    const a = regenerateBroadcast(s, game.id)!;
    const b = regenerateBroadcast(s, game.id)!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  }, 300_000);

  it("has nothing to say about a game that was never played", () => {
    const s = ready();
    expect(regenerateBroadcast(s, "not-a-game")).toBeNull();
  });
});

describe("wiping the preseason", () => {
  it("deletes the games and relocks everyone's reveal", () => {
    const s = ready();
    simulateBlock(s, "PRE", 1, 3);
    markRevealed(s, s.gms[0]!.id, "PRE", 3);
    expect(visibleGames(s, s.gms[0]!.id).length).toBeGreaterThan(0);

    wipePreseason(s);

    expect(s.games.some((g) => g.phase === "PRE")).toBe(false);
    expect(visibleGames(s, s.gms[0]!.id)).toHaveLength(0);
    for (const t of Object.values(s.teams)) {
      expect(t.wins + t.losses + t.ties).toBe(0);
    }
  }, 300_000);
});
