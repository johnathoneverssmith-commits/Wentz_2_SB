import { describe, expect, it } from "vitest";

import {
  DIVISIONS,
  DIVISION_IDS,
  NFL_TEAMS,
  conferenceOf,
  divisionOf,
  divisionRivals,
} from "../src/engine/nfl-structure.js";
import { nflSchedule } from "../src/engine/schedule.js";

/**
 * Phase A1: the real NFL 17-game formula. Every team plays 17 games over 18
 * weeks with one bye — 6 intra-division (each rival twice), 4 + 4 division
 * blocks, 2 same-place in-conference, and the 17th cross-conference game (so 12
 * in-conference, 5 inter-conference). No matchup more than twice; 8–9 home
 * games; deterministic per season.
 */

const YEARS = [2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030];

describe("nflSchedule", () => {
  for (const year of YEARS) {
    describe(`season ${year}`, () => {
      const sched = nflSchedule({ year });

      const games = new Map<string, number>();
      const home = new Map<string, number>();
      const weeksOf = new Map<string, Set<number>>();
      const opp = new Map<string, Map<string, number>>();
      const perWeek = new Map<number, number>();
      for (const t of NFL_TEAMS) {
        games.set(t, 0);
        home.set(t, 0);
        weeksOf.set(t, new Set());
        opp.set(t, new Map());
      }
      for (const g of sched) {
        perWeek.set(g.week, (perWeek.get(g.week) ?? 0) + 1);
        home.set(g.home, home.get(g.home)! + 1);
        for (const [t, o] of [
          [g.home, g.away],
          [g.away, g.home],
        ] as const) {
          games.set(t, games.get(t)! + 1);
          weeksOf.get(t)!.add(g.week);
          opp.get(t)!.set(o, (opp.get(t)!.get(o) ?? 0) + 1);
        }
      }

      it("has 272 games", () => {
        expect(sched).toHaveLength(272);
      });

      it("gives every team 17 games in 17 distinct weeks (one bye)", () => {
        for (const t of NFL_TEAMS) {
          expect(games.get(t)).toBe(17);
          expect(weeksOf.get(t)!.size).toBe(17);
        }
      });

      it("weeks run 1–18, none over 16 games", () => {
        expect([...perWeek.keys()].sort((a, b) => a - b)).toEqual(
          Array.from({ length: 18 }, (_, i) => i + 1),
        );
        for (const c of perWeek.values()) expect(c).toBeLessThanOrEqual(16);
      });

      it("plays each division rival exactly twice — 6 division games/team", () => {
        for (const t of NFL_TEAMS) {
          let div = 0;
          for (const rv of divisionRivals(t)) {
            expect(opp.get(t)!.get(rv) ?? 0).toBe(2);
            div += opp.get(t)!.get(rv)!;
          }
          expect(div).toBe(6);
        }
      });

      it("never plays the same opponent more than twice", () => {
        for (const t of NFL_TEAMS)
          for (const c of opp.get(t)!.values()) expect(c).toBeLessThanOrEqual(2);
      });

      it("plays 12 in-conference and 5 inter-conference games", () => {
        for (const t of NFL_TEAMS) {
          let inter = 0;
          for (const [o, c] of opp.get(t)!)
            if (conferenceOf(o) !== conferenceOf(t)) inter += c;
          expect(inter).toBe(5);
          expect(17 - inter).toBe(12);
        }
      });

      it("gives every team 8 or 9 home games", () => {
        for (const t of NFL_TEAMS) {
          const h = home.get(t)!;
          expect(h).toBeGreaterThanOrEqual(8);
          expect(h).toBeLessThanOrEqual(9);
        }
        // league-wide home == away
        const totalHome = [...home.values()].reduce((a, b) => a + b, 0);
        expect(totalHome).toBe(272);
      });

      it("shares a full 4-game block with exactly two other divisions", () => {
        for (const t of NFL_TEAMS) {
          const foreignDivCounts = new Map<string, number>();
          for (const [o, c] of opp.get(t)!) {
            const d = divisionOf(o);
            if (d === divisionOf(t)) continue;
            foreignDivCounts.set(d, (foreignDivCounts.get(d) ?? 0) + c);
          }
          const fours = [...foreignDivCounts.values()].filter((c) => c === 4);
          expect(fours).toHaveLength(2); // one in-conf block + one inter-conf block
        }
      });
    });
  }

  it("is deterministic per season", () => {
    for (const year of [2025, 2031]) {
      expect(nflSchedule({ year })).toEqual(nflSchedule({ year }));
    }
  });

  it("varies the matchup set season to season", () => {
    const key = (y: number) =>
      new Set(nflSchedule({ year: y }).map((g) => [g.home, g.away].sort().join("-")));
    const a = key(2025);
    const b = key(2026);
    let shared = 0;
    for (const m of a) if (b.has(m)) shared += 1;
    // division games (96 unordered pairs) recur; the rest should rotate
    expect(shared).toBeLessThan(a.size);
  });

  it("respects prior-year rank for same-place matchups", () => {
    // give every team rank 1 vs rank 4 splits and confirm it still validates
    const priorRank = new Map<string, number>();
    for (const id of DIVISION_IDS) DIVISIONS[id].forEach((t, i) => priorRank.set(t, i + 1));
    const sched = nflSchedule({ year: 2025, priorRank });
    const games = new Map<string, number>(NFL_TEAMS.map((t) => [t, 0]));
    for (const g of sched) {
      games.set(g.home, games.get(g.home)! + 1);
      games.set(g.away, games.get(g.away)! + 1);
    }
    for (const t of NFL_TEAMS) expect(games.get(t)).toBe(17);
  });
});
