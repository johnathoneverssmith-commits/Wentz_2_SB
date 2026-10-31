import { describe, expect, it } from "vitest";

import type { GameResult, LeagueState } from "@/domain";
import { archiveSeasonGames, ARCHIVE_SEASONS_KEPT, describeTrace, findGame } from "./gameHistory";

const bc = { home: "BUF", away: "KC", finalScore: [24, 20] as [number, number], drives: [{ team: "BUF", side: "home", quarter: 1, startClock: "15:00", startBallOn: 75, plays: [], ended: "touchdown", points: 7, pointsAgainst: 0 }], scoringDrives: [0], injuries: [] } as unknown as GameResult["broadcast"];
const game = (id: string, over: Partial<GameResult> = {}): GameResult => ({ id, week: 1, phase: "REG", homeTeam: "BUF", awayTeam: "KC", played: true, homeScore: 24, awayScore: 20, ...over });
const league = (games: GameResult[], extra: Partial<LeagueState> = {}): LeagueState =>
  ({ season: 2026, games, gms: [{ id: "g1", isHuman: true, teamCode: "BUF" }, { id: "g2", isHuman: false, teamCode: "NYJ" }], ...extra }) as unknown as LeagueState;

describe("game history", () => {
  it("keeps human-team games reachable after the season's games are cleared", () => {
    const s = league([game("a", { broadcast: bc }), game("b", { homeTeam: "NYJ", awayTeam: "MIA" }), game("pre", { phase: "PRE" })]);
    archiveSeasonGames(s);
    s.games = [];
    expect(findGame(s, "a")?.broadcast).toBeTruthy();
    expect(findGame(s, "b")).toBeUndefined(); // CPU-only games are not archived
    expect(findGame(s, "pre")).toBeUndefined(); // preseason is wiped by design
  });

  it("drops older seasons' traces but keeps their scores and scoring plays", () => {
    const s = league([game("y1", { broadcast: bc, scoringPlays: [{ quarter: 1, team: "BUF", description: "TD", homeScore: 7, awayScore: 0 }] })]);
    archiveSeasonGames(s);
    s.season = 2027;
    s.games = [game("y2", { broadcast: bc })];
    archiveSeasonGames(s);
    expect(findGame(s, "y1")?.broadcast).toBeUndefined();
    expect(describeTrace(findGame(s, "y1"))).toBe("summary");
    expect(describeTrace(findGame(s, "y2"))).toBe("full");
  });

  it("is idempotent and bounded", () => {
    const s = league([game("a")]);
    archiveSeasonGames(s);
    archiveSeasonGames(s);
    expect(s.gameArchive).toHaveLength(1);
    for (let y = 1; y <= ARCHIVE_SEASONS_KEPT + 2; y++) {
      s.season = 2026 + y;
      s.games = [game(`g${y}`)];
      archiveSeasonGames(s);
    }
    expect(new Set(s.gameArchive!.map((g) => g.season)).size).toBe(ARCHIVE_SEASONS_KEPT);
  });

  it("an old save with no archive and no trace says so honestly", () => {
    const s = league([game("old")]);
    expect(s.gameArchive).toBeUndefined();
    expect(findGame(s, "old")).toBeTruthy();
    expect(describeTrace(findGame(s, "old"))).toBe("none");
    expect(describeTrace(findGame(s, "missing"))).toBe("none");
    expect(describeTrace(game("u", { played: false }))).toBe("none");
  });
});
