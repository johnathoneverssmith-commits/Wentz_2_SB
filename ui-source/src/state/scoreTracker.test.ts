import { describe, expect, it } from "vitest";

import type { LeagueState, SeasonOutcome } from "@/domain";

import { buildScoreTracker } from "./scoreTracker.ts";

const outcome = (season: number, gmId: string, teamCode: string, wins: number): SeasonOutcome => ({
  season,
  gmId,
  teamCode,
  madePlayoffs: false,
  seed: 0,
  furthestRound: "none",
  wonSuperBowl: false,
  regularSeasonRecord: { wins, losses: 17 - wins, ties: 0 },
  eliminationMargin: null,
  pointDifferential: (wins - 8) * 20,
  rivalsEliminated: [],
});

/**
 * Someone who takes over a reopened seat inherits the team, not the last
 * GM's scorecard: the seasons before they arrived used to count toward them.
 */
describe("score tracker and a GM who joined late", () => {
  it("counts a newcomer only from the season they joined", () => {
    const history = [
      outcome(2027, "gm_a", "GB", 3),
      outcome(2027, "gm_b", "KC", 14),
      outcome(2028, "gm_a", "GB", 4),
      outcome(2028, "gm_b", "KC", 13),
    ];
    const base = {
      history,
      gms: [
        { id: "gm_a", name: "A", isHuman: true, teamCode: "GB" },
        { id: "gm_b", name: "B", isHuman: true, teamCode: "KC" },
      ],
    };
    const before = buildScoreTracker(base as unknown as LeagueState);
    const joined = buildScoreTracker({
      ...base,
      gms: [{ ...base.gms[0]!, joinedSeason: 2029 }, base.gms[1]!],
    } as unknown as LeagueState);

    expect(joined.cumulative.get("gm_b")).toBe(before.cumulative.get("gm_b"));
    expect(joined.cumulative.get("gm_a")).toBe(0);
    expect(joined.seasons.every((x) => x.breakdowns.every((b) => b.gmId !== "gm_a"))).toBe(true);
  });
});
