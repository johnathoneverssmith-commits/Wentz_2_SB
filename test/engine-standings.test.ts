import { describe, expect, it } from "vitest";

import {
  DIVISIONS,
  DIVISION_IDS,
  NFL_TEAMS,
  conferenceOf,
  divisionOf,
} from "../src/engine/nfl-structure.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { type FinishedGame, computeStandings } from "../src/engine/standings.js";

/**
 * Phase A1: NFL standings + seeding. These tests are pool-free — they feed
 * `computeStandings` synthetic results and check the division ranks, the
 * "division winner always outseeds a wild card" rule, and the tiebreaker chain.
 */

// deterministic pseudo-score for a decided game
function score(margin: number): [number, number] {
  return [20 + margin, 20];
}

/**
 * Play the real schedule for `year`, deciding each game by a strength function
 * (higher wins; home team gets a small edge). No ties.
 */
function syntheticSeason(year: number, strength: (t: string) => number): FinishedGame[] {
  return nflSchedule({ year }).map(({ home, away }) => {
    const diff = strength(home) + 0.25 - strength(away);
    const margin = Math.max(1, Math.min(28, Math.round(Math.abs(diff))));
    const [w, l] = score(margin);
    return diff > 0
      ? { home, away, homeScore: w, awayScore: l }
      : { home, away, homeScore: l, awayScore: w };
  });
}

describe("computeStandings — structure", () => {
  // strength = position in NFL_TEAMS (0..31); strict, no ties anywhere
  const strengthIndex = new Map(NFL_TEAMS.map((t, i) => [t, i]));
  const st = (t: string) => strengthIndex.get(t)!;
  const standings = computeStandings(syntheticSeason(2025, st));

  it("ranks all 32 teams 1–4 within their division, uniquely", () => {
    for (const id of DIVISION_IDS) {
      const ranks = standings.rows
        .filter((r) => r.division === id)
        .map((r) => r.divisionRank)
        .sort();
      expect(ranks).toEqual([1, 2, 3, 4]);
    }
  });

  it("has exactly 4 division winners and 7 seeds per conference", () => {
    for (const conf of ["AFC", "NFC"] as const) {
      const rows = standings.rows.filter((r) => r.conference === conf);
      expect(rows.filter((r) => r.wonDivision)).toHaveLength(4);
      expect(rows.filter((r) => r.madePlayoffs)).toHaveLength(7);
      const seeds = rows
        .filter((r) => r.seed != null)
        .map((r) => r.seed!)
        .sort((a, b) => a - b);
      expect(seeds).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(standings.seeding[conf].seeds).toHaveLength(7);
    }
  });

  it("seeds 1–4 are the division winners, 5–7 the wild cards", () => {
    for (const conf of ["AFC", "NFC"] as const) {
      const { seeds, divisionWinners, wildCards } = standings.seeding[conf];
      expect(seeds.slice(0, 4)).toEqual(divisionWinners);
      expect(seeds.slice(4)).toEqual(wildCards);
      for (const t of divisionWinners) expect(standings.rows.find((r) => r.team === t)!.wonDivision).toBe(true);
      for (const t of wildCards) expect(standings.rows.find((r) => r.team === t)!.wonDivision).toBe(false);
    }
  });

  it("every division's strongest team (by construction) wins it", () => {
    for (const id of DIVISION_IDS) {
      const strongest = [...DIVISIONS[id]].sort((a, b) => st(b) - st(a))[0]!;
      expect(standings.rows.find((r) => r.team === strongest)!.divisionRank).toBe(1);
    }
  });

  it("is deterministic", () => {
    const again = computeStandings(syntheticSeason(2025, st));
    expect(again.seeding).toEqual(standings.seeding);
    expect(again.rows.map((r) => [r.team, r.seed, r.divisionRank])).toEqual(
      standings.rows.map((r) => [r.team, r.seed, r.divisionRank]),
    );
  });
});

describe("computeStandings — division winner outseeds a better wild card", () => {
  // Make one whole division weak so its winner has a losing record, and another
  // division's runner-up strong so it would outrank that winner on record.
  const weakDiv = "AFC South";
  const st = (t: string) => {
    if (divisionOf(t) === weakDiv) return -50; // everyone here loses most games
    return NFL_TEAMS.indexOf(t);
  };
  const standings = computeStandings(syntheticSeason(2025, st));

  it("the weak division still sends its winner as a top-4 seed", () => {
    const winner = standings.rows.find((r) => r.division === weakDiv && r.wonDivision)!;
    expect(winner.seed).not.toBeNull();
    expect(winner.seed!).toBeLessThanOrEqual(4);
    expect(winner.winPct).toBeLessThan(0.5); // losing record
  });

  it("a wild card with a better record is still seeded 5–7", () => {
    const afc = standings.rows.filter((r) => r.conference === "AFC");
    const weakWinner = afc.find((r) => r.division === weakDiv && r.wonDivision)!;
    const wildCards = afc.filter((r) => r.madePlayoffs && !r.wonDivision);
    expect(wildCards).toHaveLength(3);
    for (const wc of wildCards) {
      expect(wc.seed!).toBeGreaterThanOrEqual(5);
      // at least one wild card genuinely has a better record than the weak winner
    }
    expect(wildCards.some((wc) => wc.winPct > weakWinner.winPct)).toBe(true);
  });
});

describe("computeStandings — tiebreakers", () => {
  it("head-to-head decides a two-team division tie", () => {
    // Pool = two NFC East teams (A, B) + two out-of-division fillers, so the
    // NFC East race is purely A vs B. Both finish 2-2; A swept B.
    const [A, B] = DIVISIONS["NFC East"];
    const [F1, F2] = DIVISIONS["NFC West"];
    const games: FinishedGame[] = [
      { home: A!, away: B!, homeScore: 24, awayScore: 17 },
      { home: B!, away: A!, homeScore: 13, awayScore: 20 },
      { home: F1!, away: A!, homeScore: 27, awayScore: 20 },
      { home: F2!, away: A!, homeScore: 21, awayScore: 14 },
      { home: B!, away: F1!, homeScore: 28, awayScore: 24 },
      { home: B!, away: F2!, homeScore: 27, awayScore: 20 },
      { home: F1!, away: F2!, homeScore: 17, awayScore: 20 },
      { home: F2!, away: F1!, homeScore: 13, awayScore: 24 },
    ];
    const standings = computeStandings(games, [A!, B!, F1!, F2!]);
    const rank = (t: string) => standings.rows.find((r) => r.team === t)!.divisionRank;
    const rowA = standings.rows.find((r) => r.team === A)!;
    const rowB = standings.rows.find((r) => r.team === B)!;
    expect([rowA.wins, rowA.losses]).toEqual([rowB.wins, rowB.losses]); // both 2-2
    expect(rank(A!)).toBe(1);
    expect(rank(B!)).toBe(2);
  });

  it("conference record breaks a tie between teams from different divisions", () => {
    // Two AFC wild-card contenders, same overall record; one is 3-0 vs the
    // conference, the other 1-2. Third parties fill out the schedule.
    const X = "BUF"; // AFC East
    const Y = "DEN"; // AFC West
    const confFoe = ["MIA", "NE", "NYJ"]; // AFC (East)
    const nonConfFoe = ["DAL", "NYG", "PHI"]; // NFC
    const games: FinishedGame[] = [];
    // X: 3-0 vs conference foes, 0-3 vs non-conf  → 3-3
    for (const f of confFoe) games.push({ home: X, away: f, homeScore: 27, awayScore: 20 });
    for (const f of nonConfFoe) games.push({ home: f, away: X, homeScore: 24, awayScore: 10 });
    // Y: 1-2 vs conference foes, 2-1 vs non-conf  → 3-3
    games.push({ home: Y, away: confFoe[0]!, homeScore: 30, awayScore: 13 });
    games.push({ home: confFoe[1]!, away: Y, homeScore: 21, awayScore: 17 });
    games.push({ home: confFoe[2]!, away: Y, homeScore: 24, awayScore: 20 });
    games.push({ home: Y, away: nonConfFoe[0]!, homeScore: 28, awayScore: 21 });
    games.push({ home: Y, away: nonConfFoe[1]!, homeScore: 26, awayScore: 14 });
    games.push({ home: nonConfFoe[2]!, away: Y, homeScore: 30, awayScore: 24 });

    const pool = [X, Y, ...confFoe, ...nonConfFoe];
    const standings = computeStandings(games, pool);
    const rowX = standings.rows.find((r) => r.team === X)!;
    const rowY = standings.rows.find((r) => r.team === Y)!;
    expect(rowX.wins - rowX.losses).toBe(rowY.wins - rowY.losses);
    // both are division "winners" in this sparse pool (only ones with games in
    // their division), so compare their seeds: X's better conference record wins
    expect(rowX.seed!).toBeLessThan(rowY.seed!);
  });
});
