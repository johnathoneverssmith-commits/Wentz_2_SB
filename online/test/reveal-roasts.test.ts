import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import {
  hasMoreToReveal,
  markRevealed,
  markRoundRevealed,
  revealedRounds,
  revealedWeek,
  visibleGames,
} from "@/state/reveal.ts";
import { roastContext, roastFor, roastsForWeek } from "@/state/roasts.ts";

/**
 * Change 6 — reveal state and commentary.
 *
 * The block is simulated once, at the checkpoint. Everything after that is a
 * reveal, per GM, permanent. The rule that makes it safe is that nothing
 * unrevealed may appear anywhere — a standings table built from the league's
 * saved truth rather than from what this GM has watched would quietly spoil
 * a game they have not seen.
 */
function league(): LeagueState {
  const s = createLeague(9753, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  // a precomputed three-week preseason
  for (let week = 1; week <= 3; week++) {
    s.games.push({
      id: `2026-PRE-${week}-KC-BUF`,
      week,
      phase: "PRE",
      homeTeam: "KC",
      awayTeam: "BUF",
      played: true,
      homeScore: 20 + week,
      awayScore: 17,
      injuries: [],
    } as never);
  }
  return s;
}

describe("reveal state", () => {
  it("starts with nothing revealed", () => {
    const s = league();
    expect(revealedWeek(s, s.gms[0]!.id, "PRE")).toBe(0);
    expect(visibleGames(s, s.gms[0]!.id)).toHaveLength(0);
  });

  it("shows only what that GM has revealed", () => {
    const s = league();
    const me = s.gms[0]!.id;
    markRevealed(s, me, "PRE", 2);
    const seen = visibleGames(s, me);
    expect(seen).toHaveLength(2);
    expect(seen.every((g) => g.week <= 2)).toBe(true);
  });

  it("keeps one GM's progress out of another's", () => {
    const s = league();
    const me = s.gms[0]!.id;
    const them = s.gms[1]!.id;
    markRevealed(s, me, "PRE", 3);
    expect(visibleGames(s, me)).toHaveLength(3);
    // the other GM has watched nothing and must still see nothing
    expect(visibleGames(s, them)).toHaveLength(0);
  });

  it("never moves a marker backward", () => {
    const s = league();
    const me = s.gms[0]!.id;
    markRevealed(s, me, "PRE", 3);
    markRevealed(s, me, "PRE", 1);
    expect(revealedWeek(s, me, "PRE")).toBe(3);
  });

  it("knows when a GM is done with the block", () => {
    const s = league();
    const me = s.gms[0]!.id;
    expect(hasMoreToReveal(s, me, "PRE", 3)).toBe(true);
    markRevealed(s, me, "PRE", 3);
    expect(hasMoreToReveal(s, me, "PRE", 3)).toBe(false);
  });

  it("tracks playoff rounds separately and without duplicates", () => {
    const s = league();
    const me = s.gms[0]!.id;
    markRoundRevealed(s, me, "WC");
    markRoundRevealed(s, me, "WC");
    markRoundRevealed(s, me, "DIV");
    expect(revealedRounds(s, me)).toEqual(["WC", "DIV"]);
  });
});

describe("roasts", () => {
  const games = [{ homeTeam: "KC", awayTeam: "BUF", homeScore: 45, awayScore: 3 }];

  it("gives every human team exactly one line", () => {
    const s = league();
    const out = roastsForWeek(s, games, "pre-1");
    expect(out).toHaveLength(2);
    for (const r of out) expect(r.line.length).toBeGreaterThan(10);
  });

  it("is deterministic — a reload does not reroll the joke", () => {
    const s = league();
    const a = roastsForWeek(s, games, "pre-1");
    const b = roastsForWeek(s, games, "pre-1");
    expect(a).toEqual(b);
  });

  it("says something different in a different week", () => {
    const s = league();
    const w1 = roastsForWeek(s, games, "pre-1");
    const w2 = roastsForWeek(s, games, "pre-2");
    // same situation, different seed: the library should not be a single line
    expect(w1.map((x) => x.line).join()).not.toBe(w2.map((x) => x.line).join());
  });

  it("is about what actually happened", () => {
    const s = league();
    const blowout = roastContext(s, "KC", "You", games, false);
    const beaten = roastContext(s, "BUF", "Them", games, false);
    expect(blowout.biggestMargin).toBe(42);
    expect(beaten.biggestMargin).toBe(-42);
    // the winner's line and the loser's line come from different buckets
    expect(roastFor(blowout, "k")).not.toBe(roastFor(beaten, "k"));
  });

  it("roasts a bye as a bye rather than reaching for an old game", () => {
    const s = league();
    const ctx = roastContext(s, "KC", "You", [], false);
    expect(ctx.onBye).toBe(true);
    expect(roastFor(ctx, "x")).toMatch(/bye|rest|not played/i);
  });

  it("uses the draft for season one, when there are no games yet", () => {
    const s = league();
    const ctx = roastContext(s, "KC", "You", [], true);
    expect(ctx.fromDraft).toBe(true);
    expect(ctx.onBye).toBe(false);
    expect(roastFor(ctx, "d").length).toBeGreaterThan(10);
  });

  it("never leaves a placeholder unfilled", () => {
    const s = league();
    for (const seed of ["a", "b", "c", "d", "e"]) {
      for (const r of roastsForWeek(s, games, seed)) {
        expect(r.line).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });
});
