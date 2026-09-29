import { describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { pastTradeDeadline } from "./tradeDeadline";
import { seasonShape } from "./leagueFormat";
import { TEAMS } from "@/data/teams";

/** A 32-team NFL league at a given stage and week — all the rule reads. */
const at = (stage: string, week = 1) =>
  ({
    stage,
    week,
    config: {},
    teams: Object.fromEntries(TEAMS.map((t) => [t.code, {}])),
  }) as unknown as LeagueState;

describe("the trade deadline", () => {
  const deadline = seasonShape(at("regularSeason")).deadlineWeek;

  it("is open in the offseason and the first half of the season", () => {
    for (const stage of ["offseasonRetirement", "offseasonDepthChart", "preseason", "tradeDeadline"]) {
      expect(pastTradeDeadline(at(stage)), stage).toBe(false);
    }
    expect(pastTradeDeadline(at("regularSeason", deadline))).toBe(false);
  });

  it("stays shut from the deadline through the playoffs", () => {
    for (const stage of ["tradeDeadlineSummary", "midseasonFreeAgency", "midseasonDepthChart", "playoffs"]) {
      expect(pastTradeDeadline(at(stage)), stage).toBe(true);
    }
    expect(pastTradeDeadline(at("regularSeason", deadline + 1))).toBe(true);
  });
});
