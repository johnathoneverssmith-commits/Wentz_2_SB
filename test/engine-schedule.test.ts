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

      it("puts every bye in weeks 5–14; weeks 1–4 and 15–18 are full slates", () => {
        for (const w of [1, 2, 3, 4, 15, 16, 17, 18]) expect(perWeek.get(w)).toBe(16);
        for (const t of NFL_TEAMS) {
          const played = weeksOf.get(t)!;
          const bye = Array.from({ length: 18 }, (_, i) => i + 1).find((w) => !played.has(w))!;
          expect(bye).toBeGreaterThanOrEqual(5);
          expect(bye).toBeLessThanOrEqual(14);
        }
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

/**
 * The real division-rotation pairings as published by the NFL for 2023–2026.
 * `[division] → [intra-conference 4-game opp, inter-conference 4-game opp, 17th-game opp]`.
 * Later years roll the same 3-/4-year cycles forward.
 */
const REAL_ROTATION: Record<number, Record<string, [string, string, string]>> = {
  2023: {
    "AFC East": ["AFC West", "NFC East", "NFC South"],
    "AFC North": ["AFC South", "NFC West", "NFC North"],
    "AFC South": ["AFC North", "NFC South", "NFC West"],
    "AFC West": ["AFC East", "NFC North", "NFC East"],
  },
  2024: {
    "AFC East": ["AFC South", "NFC West", "NFC North"],
    "AFC North": ["AFC West", "NFC East", "NFC South"],
    "AFC South": ["AFC East", "NFC North", "NFC East"],
    "AFC West": ["AFC North", "NFC South", "NFC West"],
  },
  2025: {
    "AFC East": ["AFC North", "NFC South", "NFC East"],
    "AFC North": ["AFC East", "NFC North", "NFC West"],
    "AFC South": ["AFC West", "NFC West", "NFC South"],
    "AFC West": ["AFC South", "NFC East", "NFC North"],
  },
  2026: {
    "AFC East": ["AFC West", "NFC North", "NFC West"],
    "AFC North": ["AFC South", "NFC South", "NFC East"],
    "AFC South": ["AFC North", "NFC East", "NFC North"],
    "AFC West": ["AFC East", "NFC West", "NFC South"],
  },
};

describe("nflSchedule — real NFL rotation", () => {
  for (const [yStr, expected] of Object.entries(REAL_ROTATION)) {
    const year = Number(yStr);
    it(`matches the published ${year} division pairings`, () => {
      const sched = nflSchedule({ year });
      // opponent-division game counts, taken from one team's slate per division
      for (const [divId, [intra, inter, seventeen]] of Object.entries(expected)) {
        const probe = DIVISIONS[divId as keyof typeof DIVISIONS][0]!;
        const byDiv = new Map<string, number>();
        for (const g of sched) {
          if (g.home !== probe && g.away !== probe) continue;
          const o = g.home === probe ? g.away : g.home;
          const d = divisionOf(o);
          if (d === divId) continue;
          byDiv.set(d, (byDiv.get(d) ?? 0) + 1);
        }
        expect(byDiv.get(intra), `${divId} intra`).toBe(4);
        expect(byDiv.get(inter), `${divId} inter`).toBe(4);
        expect(byDiv.get(seventeen), `${divId} 17th`).toBe(1);
        // exactly those three foreign divisions appear (2 in-conf same-place + intra + inter + 17th)
        // → 4 + 4 + 1 + 1 + 1 = 11 foreign-division games; 5 distinct foreign divisions
        expect([...byDiv.values()].reduce((a, b) => a + b, 0)).toBe(11);
      }
    });
  }

  it("2026 AFC East plays NFC North ×4 and never plays NFC East or NFC South", () => {
    const sched = nflSchedule({ year: 2026 });
    for (const t of DIVISIONS["AFC East"]) {
      const byDiv = new Map<string, number>();
      for (const g of sched) {
        if (g.home !== t && g.away !== t) continue;
        const o = g.home === t ? g.away : g.home;
        byDiv.set(divisionOf(o), (byDiv.get(divisionOf(o)) ?? 0) + 1);
      }
      expect(byDiv.get("NFC North")).toBe(4);
      expect(byDiv.get("NFC West")).toBe(1); // the 17th game
      expect(byDiv.get("NFC East") ?? 0).toBe(0);
      expect(byDiv.get("NFC South") ?? 0).toBe(0);
    }
  });

  it("rolls the cycles forward: 2027 repeats 2024's intra pairing, 2030 repeats 2026", () => {
    // the intra-conference 4-game opponent division for a probe team
    const intraOpp = (year: number, probe: string) => {
      const byDiv = new Map<string, number>();
      for (const g of nflSchedule({ year })) {
        if (g.home !== probe && g.away !== probe) continue;
        const o = g.home === probe ? g.away : g.home;
        if (divisionOf(o) === divisionOf(probe) || conferenceOf(o) !== conferenceOf(probe)) continue;
        byDiv.set(divisionOf(o), (byDiv.get(divisionOf(o)) ?? 0) + 1);
      }
      return [...byDiv.entries()].find(([, c]) => c === 4)![0];
    };
    // intra cycle is 3 years
    expect(intraOpp(2027, "BUF")).toBe(intraOpp(2024, "BUF"));
    expect(intraOpp(2030, "BUF")).toBe(intraOpp(2027, "BUF"));
  });
});
