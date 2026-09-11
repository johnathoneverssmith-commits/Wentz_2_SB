import { describe, expect, it } from "vitest";

import type { SeasonOutcome } from "@/domain";

import { bucketB, bucketD, scoreSeason } from "./scoring.ts";

function outcome(p: Partial<SeasonOutcome>): SeasonOutcome {
  return {
    season: 1,
    gmId: "g",
    teamCode: "CLE",
    madePlayoffs: false,
    seed: 0,
    furthestRound: "none",
    wonSuperBowl: false,
    regularSeasonRecord: { wins: 9, losses: 8, ties: 0 },
    eliminationMargin: null,
    pointDifferential: 0,
    rivalsEliminated: [],
    ...p,
  };
}

describe("bucket B — playoff progression", () => {
  it("missed playoffs = 0", () => {
    expect(bucketB(outcome({ madePlayoffs: false }))).toBe(0);
  });
  it("lost in the wild card = 1", () => {
    expect(bucketB(outcome({ madePlayoffs: true, furthestRound: "WC" }))).toBe(1);
  });
  it("lost in the divisional round = 2 (made + WC survived)", () => {
    expect(bucketB(outcome({ madePlayoffs: true, furthestRound: "DIV" }))).toBe(2);
  });
  it("lost in the Super Bowl = 4", () => {
    expect(bucketB(outcome({ madePlayoffs: true, furthestRound: "SB" }))).toBe(4);
  });
  it("won the Super Bowl = 1 + 4 rounds + 2 bonus = 7", () => {
    expect(bucketB(outcome({ madePlayoffs: true, furthestRound: "SB", wonSuperBowl: true }))).toBe(7);
  });
});

describe("bucket D — season quality", () => {
  it("losing record costs 1", () => {
    expect(bucketD(outcome({ regularSeasonRecord: { wins: 7, losses: 10, ties: 0 } }))).toBe(-1);
  });
  it(".500 or better costs nothing", () => {
    expect(bucketD(outcome({ regularSeasonRecord: { wins: 9, losses: 8, ties: 0 } }))).toBe(0);
  });
});

describe("scoreSeason — spec §5 worked examples", () => {
  it("weak division winner, losing record, lost in the wild card → +1 − 1 = 0", () => {
    const [b] = scoreSeason({
      season: 1,
      outcomes: [
        outcome({
          gmId: "solo",
          madePlayoffs: true,
          furthestRound: "WC",
          regularSeasonRecord: { wins: 8, losses: 9, ties: 0 },
        }),
      ],
      headToHead: () => 0,
    });
    expect(b!.bucketA).toBe(1); // only human GM in the field → went farthest
    expect(b!.bucketB).toBe(1);
    expect(b!.bucketD).toBe(-1);
    expect(b!.seasonTotal).toBe(1);
  });

  it("#1-seed Super Bowl champion who eliminated a rival = 9", () => {
    const [b] = scoreSeason({
      season: 1,
      outcomes: [
        outcome({
          gmId: "champ",
          madePlayoffs: true,
          seed: 1,
          furthestRound: "SB",
          wonSuperBowl: true,
          regularSeasonRecord: { wins: 15, losses: 2, ties: 0 },
          rivalsEliminated: ["DAL"],
        }),
        outcome({ gmId: "rival", teamCode: "DAL", madePlayoffs: true, furthestRound: "DIV" }),
      ],
      headToHead: () => 0,
    });
    expect(b!.bucketA).toBe(1);
    expect(b!.bucketB).toBe(7);
    expect(b!.bucketC).toBe(1);
    expect(b!.bucketD).toBe(0);
    expect(b!.seasonTotal).toBe(9);
  });

  it("bucket A splits when every tiebreak is exhausted", () => {
    const rows = scoreSeason({
      season: 1,
      outcomes: [
        outcome({ gmId: "a", madePlayoffs: true, furthestRound: "CONF", eliminationMargin: 7, pointDifferential: 20 }),
        outcome({ gmId: "b", madePlayoffs: true, furthestRound: "CONF", eliminationMargin: 7, pointDifferential: 20 }),
        outcome({ gmId: "c", madePlayoffs: true, furthestRound: "CONF", eliminationMargin: 7, pointDifferential: 20 }),
      ],
      headToHead: () => 0, // 3-way tie skips head-to-head
    });
    expect(rows.map((r) => r.bucketA)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });
});
