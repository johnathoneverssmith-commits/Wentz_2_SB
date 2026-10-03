import { describe, expect, it } from "vitest";

import type { GameResult } from "@/domain";

import { productionRanks } from "./productionRanks.ts";

const teams = { A: {}, B: {}, C: {} } as never;
const game = (week: number, home: string, away: string, hs: number, as: number, fg?: string): GameResult =>
  ({
    id: `${week}-${home}-${away}`,
    week,
    phase: "REG",
    homeTeam: home,
    awayTeam: away,
    played: true,
    homeScore: hs,
    awayScore: as,
    scoringPlays: fg ? [{ quarter: 2, team: fg, description: "45-yd field goal", homeScore: 3, awayScore: 0 }] : [],
  }) as unknown as GameResult;

describe("season production ranks", () => {
  it("is null until a regular-season game has been played", () => {
    expect(productionRanks({ teams }, [])).toBeNull();
    expect(productionRanks({ teams }, [{ ...game(1, "A", "B", 10, 3), phase: "PRE" } as GameResult])).toBeNull();
  });

  it("ranks offense on points scored and defense on points allowed, per game", () => {
    const r = productionRanks({ teams }, [game(1, "A", "B", 31, 10), game(2, "C", "A", 17, 24), game(3, "B", "C", 20, 12)])!;
    // A scored 31 and 24, B 10 and 20, C 17 and 12
    expect(r.get("A")!.offense).toBe(1);
    expect(r.get("C")!.offense).toBe(3);
    // A allowed 10 and 17, B allowed 31 and 12, C allowed 24 and 20
    expect(r.get("A")!.defense).toBe(1);
    expect(r.get("C")!.defense).toBe(3);
  });

  it("moves when another box score comes in", () => {
    const before = productionRanks({ teams }, [game(1, "A", "B", 31, 10), game(2, "C", "B", 24, 17)])!;
    expect(before.get("A")!.offense).toBe(1);
    const after = productionRanks({ teams }, [game(1, "A", "B", 31, 10), game(2, "C", "B", 24, 17), game(3, "A", "C", 3, 45)])!;
    expect(after.get("A")!.offense).toBeGreaterThan(1);
    expect(after.get("C")!.offense).toBe(1);
  });

  it("ranks special teams on field-goal points, and says so when there are none", () => {
    const some = productionRanks({ teams }, [game(1, "A", "B", 3, 0, "A"), game(2, "B", "C", 0, 0)])!;
    expect(some.get("A")!.specialTeams).toBe(1);
    const none = productionRanks({ teams }, [game(1, "A", "B", 14, 7)])!;
    expect(none.get("A")!.specialTeams).toBeNull();
  });
});
