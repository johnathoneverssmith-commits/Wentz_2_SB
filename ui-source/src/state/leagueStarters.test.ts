import { describe, expect, it } from "vitest";
import type { LeagueState } from "@/domain";
import { leagueStarterOverall, startersAt } from "./leagueStarters";

type S = Pick<LeagueState, "players" | "teams" | "depthChart">;
const p = (id: string, team: string, position: string, overall: number, extra: Record<string, unknown> = {}) =>
  [id, { id, nfl_team: team, position, overall, retired: false, ...extra }] as const;
const league = (players: ReadonlyArray<readonly [string, object]>, depthChart: S["depthChart"] = {}): S =>
  ({ players: Object.fromEntries(players), teams: { AAA: {}, BBB: {} }, depthChart }) as unknown as S;

describe("league starter overall", () => {
  it("averages each team's starter, in depth-chart order rather than by rating", () => {
    const s = league(
      [p("a1", "AAA", "QB", 90), p("a2", "AAA", "QB", 60), p("b1", "BBB", "QB", 70)],
      { AAA: { QB: ["a2", "a1"] } } as S["depthChart"],
    );
    // AAA starts its 60 by choice; the league starter is (60 + 70) / 2
    expect(leagueStarterOverall(s).QB).toBe(65);
  });

  it("counts every starter where a position starts more than one", () => {
    expect(startersAt("WR")).toBe(3);
    const s = league([
      p("w1", "AAA", "WR", 90), p("w2", "AAA", "WR", 80), p("w3", "AAA", "WR", 70), p("w4", "AAA", "WR", 10),
    ]);
    expect(leagueStarterOverall(s).WR).toBe(80);
  });

  it("leaves out the practice squad, free agents and the retired", () => {
    const s = league([
      p("a1", "AAA", "QB", 70),
      p("ps", "PS:AAA", "QB", 99),
      p("fa", "FA", "QB", 99),
      p("old", "BBB", "QB", 99, { retired: true }),
    ]);
    expect(leagueStarterOverall(s).QB).toBe(70);
  });

  it("reports nothing, not zero, for a position nobody plays", () => {
    expect(leagueStarterOverall(league([])).QB).toBeUndefined();
  });
});
