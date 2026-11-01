import { describe, expect, it } from "vitest";
import type { GameResult, LeagueState } from "@/domain";
import { atmosphereLevel, humanRanking, rankLabel } from "./humanRank";
import { gameTitle, possessive } from "./gameTitle";

const game = (week: number, home: string, away: string, hs: number, as: number): GameResult =>
  ({ id: `${week}${home}${away}`, week, phase: "REG", homeTeam: home, awayTeam: away, homeScore: hs, awayScore: as, played: true }) as unknown as GameResult;

function league(humans: string[], games: GameResult[]): LeagueState {
  const teams: Record<string, unknown> = {};
  for (const c of [...humans, "CPU1", "CPU2"]) teams[c] = {};
  return {
    teams,
    gms: humans.map((t, i) => ({ id: `g${i}`, name: t, isHuman: true, teamCode: t })),
    games,
    // viewer has revealed everything
    reveal: { preseasonWeek: {}, regularWeek: Object.fromEntries(humans.map((_, i) => [`g${i}`, 99])) },
    config: {},
  } as unknown as LeagueState;
}

describe("human-GM ranking", () => {
  it("is not meaningful before anyone has played", () => {
    const r = humanRanking(league(["AAA", "BBB"], []), "g0");
    expect(r.meaningful).toBe(false);
    expect(atmosphereLevel(r, "AAA")).toBe(0.5);
  });
  it("a lone human GM is never ranked", () => {
    const r = humanRanking(league(["AAA"], [game(1, "AAA", "CPU1", 20, 10)]), "g0");
    expect(r.meaningful).toBe(false);
    expect(atmosphereLevel(r, "AAA")).toBe(0.5);
  });
  it("ranks only human teams; CPU results do not matter", () => {
    const r = humanRanking(league(["AAA", "BBB", "CCC"], [
      game(1, "AAA", "CPU1", 30, 3), game(1, "BBB", "CPU2", 10, 20), game(1, "CCC", "CPU1", 17, 16),
    ]), "g0");
    expect(r.meaningful).toBe(true);
    expect(r.byTeam.AAA!.rank).toBe(1);
    expect(r.byTeam.AAA!.tied).toBe(true); // AAA and CCC both 1-0
    expect(rankLabel(r.byTeam.AAA!)).toBe("T-1");
    expect(rankLabel(r.byTeam.BBB!)).toBe("3");
    expect(atmosphereLevel(r, "AAA")).toBeCloseTo(0.75);
    expect(atmosphereLevel(r, "BBB")).toBe(0);
    expect(atmosphereLevel(r, "CPU1")).toBe(0.5);
  });
  it("sole leader is 1.0 and sole trailer 0", () => {
    const r = humanRanking(league(["AAA", "BBB", "CCC"], [
      game(1, "AAA", "BBB", 20, 10), game(2, "AAA", "CCC", 20, 10), game(3, "BBB", "CCC", 20, 10),
    ]), "g0");
    expect(r.rows.map((x) => rankLabel(x))).toEqual(["1", "2", "3"]);
    expect(atmosphereLevel(r, "AAA")).toBe(1);
    expect(atmosphereLevel(r, "CCC")).toBe(0);
  });
  it("counts a tie as half a win", () => {
    const r = humanRanking(league(["AAA", "BBB"], [game(1, "AAA", "BBB", 10, 10)]), "g0");
    expect(r.byTeam.AAA!.ties).toBe(1);
    expect(r.byTeam.AAA!.tied).toBe(true);
    expect(atmosphereLevel(r, "AAA")).toBe(0.5);
  });
});

describe("game title", () => {
  it("is plain before a team is chosen", () => {
    expect(gameTitle()).toBe("Road to the Super Bowl");
    expect(gameTitle("  ")).toBe("Road to the Super Bowl");
  });
  it("uses the possessive correctly", () => {
    expect(gameTitle("Browns")).toBe("The Browns' Road to the Super Bowl");
    expect(gameTitle("49ers")).toBe("The 49ers' Road to the Super Bowl");
    expect(possessive("Chiefs")).toBe("Chiefs'");
    expect(possessive("Crew")).toBe("Crew's");
  });
});
