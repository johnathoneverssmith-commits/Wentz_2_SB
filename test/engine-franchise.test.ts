import { describe, expect, it } from "vitest";

import { DIVISIONS, DIVISION_IDS, NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { priorRankFromStandings } from "../src/engine/season.js";
import { type FinishedGame, computeStandings } from "../src/engine/standings.js";

/**
 * Phase A1: the multi-season glue. `priorRankFromStandings` turns a finished
 * season into the `priorRank` map the next season's schedule wants, and the
 * schedule's same-place matchups actually respond to it.
 */

function syntheticSeason(year: number, strength: (t: string) => number): FinishedGame[] {
  return nflSchedule({ year }).map(({ home, away }) => {
    const diff = strength(home) + 0.25 - strength(away);
    const m = Math.max(1, Math.min(28, Math.round(Math.abs(diff))));
    return diff > 0
      ? { home, away, homeScore: 20 + m, awayScore: 20 }
      : { home, away, homeScore: 20, awayScore: 20 + m };
  });
}

describe("priorRankFromStandings", () => {
  const st = new Map(NFL_TEAMS.map((t, i) => [t, i]));
  const standings = computeStandings(syntheticSeason(2025, (t) => st.get(t)!));
  const pr = priorRankFromStandings(standings);

  it("maps every team to a 1–4 division rank", () => {
    expect(pr.size).toBe(32);
    for (const t of NFL_TEAMS) {
      const r = pr.get(t)!;
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(4);
    }
  });

  it("has exactly one team at each rank in every division", () => {
    for (const id of DIVISION_IDS) {
      const ranks = DIVISIONS[id].map((t) => pr.get(t)!).sort();
      expect(ranks).toEqual([1, 2, 3, 4]);
    }
  });

  it("agrees with the standings rows it came from", () => {
    for (const row of standings.rows) expect(pr.get(row.team)).toBe(row.divisionRank);
  });
});

describe("schedule responds to priorRank", () => {
  const year = 2025;
  const flat = nflSchedule({ year }); // everyone defaults to rank 4

  // Reverse just the two East divisions' rank order (rest stay at the
  // alphabetical default). Same-place pairings match rank-for-rank, so a
  // non-uniform reordering shifts which teams meet.
  const ranked = new Map<string, number>();
  for (const id of ["AFC East", "NFC East"] as const)
    DIVISIONS[id].forEach((t, i) => ranked.set(t, 4 - i));
  const withRanks = nflSchedule({ year, priorRank: ranked });

  const key = (gs: { home: string; away: string }[]) =>
    new Set(gs.map((g) => [g.home, g.away].sort().join("-")));

  it("still produces a valid 272-game season", () => {
    expect(withRanks).toHaveLength(272);
    const gp = new Map<string, number>(NFL_TEAMS.map((t) => [t, 0]));
    for (const g of withRanks) {
      gp.set(g.home, gp.get(g.home)! + 1);
      gp.set(g.away, gp.get(g.away)! + 1);
    }
    for (const t of NFL_TEAMS) expect(gp.get(t)).toBe(17);
  });

  it("changes the same-place matchups vs the default-rank schedule", () => {
    const a = key(flat);
    const b = key(withRanks);
    let shared = 0;
    for (const m of a) if (b.has(m)) shared += 1;
    // the 6 division games + the two full 4-game blocks per team are
    // rank-independent; the same-place pairings shift, so some matchups differ
    expect(shared).toBeLessThan(a.size);
  });

  it("is deterministic for a given priorRank", () => {
    expect(nflSchedule({ year, priorRank: ranked })).toEqual(withRanks);
  });
});
