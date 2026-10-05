import { describe, expect, it } from "vitest";

import type { GameResult, TeamGameTotals } from "@/domain";

import { teamProduction } from "./teamProduction";

const totals = (o: Partial<TeamGameTotals>): TeamGameTotals => ({
  points: 20, totalYards: 350, passYards: 230, rushYards: 120, plays: 62, thirdDownMade: 5, thirdDownAtt: 12,
  topSeconds: 1800, penalties: 5, penaltyYards: 40, turnovers: 1, byQuarter: [0, 0, 0, 0], ...o,
});
const game = (home: string, away: string, h: Partial<TeamGameTotals>, a: Partial<TeamGameTotals>): GameResult =>
  ({
    id: `${home}-${away}`, week: 1, phase: "REG", homeTeam: home, awayTeam: away, played: true,
    homeScore: h.points ?? 20, awayScore: a.points ?? 20, totals: { home: totals(h), away: totals(a) },
  }) as unknown as GameResult;

describe("team production", () => {
  const codes = ["AAA", "BBB", "CCC"];

  it("is null before a regular-season game has been played", () => {
    expect(teamProduction([], codes)).toBeNull();
  });

  it("computes per-game averages, ratios and totals, and ranks them", () => {
    const p = teamProduction(
      [
        game("AAA", "BBB", { points: 30, passComp: 20, passAtt: 30, sacksAllowed: 2, qbHits: 4, intThrown: 1, kickPoints: 9, startSum: 250, startN: 10 },
          { points: 10, passComp: 15, passAtt: 30, sacksAllowed: 5, qbHits: 5, intThrown: 3, fumblesLost: 2, kickPoints: 3, startSum: 300, startN: 10 }),
        game("CCC", "AAA", { points: 17, kickPoints: 6 }, { points: 27, passComp: 10, passAtt: 20, sacksAllowed: 0, qbHits: 0 }),
      ],
      codes,
    )!;
    expect(p.get("AAA")!.points.value).toBe(28.5);
    expect(p.get("AAA")!.points.rank).toBe(1);
    // 30 of 50 attempts across both games that carry the figure
    expect(p.get("AAA")!.compPct.value).toBeCloseTo(60, 5);
    // pressure: (2 + 4) over (30 + 2), then (0 + 0) over (20 + 0)
    expect(p.get("AAA")!.pressure.value).toBeCloseTo((6 / 52) * 100, 5);
    // defence reads the opponent's side: BBB threw 3 picks against AAA's defence
    expect(p.get("AAA")!.interceptions.value).toBe(3);
    // no game carries AAA's fumbles, so BBB has no recovery figure rather than a zero
    expect(p.get("BBB")!.recoveries.value).toBeNull();
    expect(p.get("AAA")!.recoveries.value).toBe(2);
    expect(p.get("AAA")!.pointsAllowed.value).toBe(13.5);
    expect(p.get("AAA")!.pointsAllowed.rank).toBe(1); // fewest allowed ranks first
    // only the games that carry the figure count: one game, 9 points
    expect(p.get("AAA")!.kickPoints.value).toBe(9);
    // where each side started, and where its opponents did
    expect(p.get("AAA")!.startOwn.value).toBe(25);
    expect(p.get("AAA")!.startOpp.value).toBe(30);
  });

  it("leaves a figure null when no game carries it, instead of a wrong zero", () => {
    const p = teamProduction([game("AAA", "BBB", {}, {})], codes)!;
    expect(p.get("AAA")!.separation.value).toBeNull();
    expect(p.get("AAA")!.separation.rank).toBeNull();
    expect(p.get("AAA")!.startOwn.value).toBeNull();
  });

  it("ignores the preseason", () => {
    const g = { ...game("AAA", "BBB", {}, {}), phase: "PRE" } as GameResult;
    expect(teamProduction([g], codes)).toBeNull();
  });
});
