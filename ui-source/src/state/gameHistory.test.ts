import { describe, expect, it } from "vitest";

import type { GameResult, LeagueState } from "@/domain";
import { archiveSeasonGames, ARCHIVE_PRESEASONS_KEPT, ARCHIVE_SEASONS_KEPT, describeTrace, findGame, visibleArchive } from "./gameHistory";
import { emptyReveal, markRevealed, markRoundRevealed } from "./reveal";

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
    expect(findGame(s, "pre")).toBeDefined(); // preseason is kept too, without its trace
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

  it("keeps preseason games without traces, for only the last few seasons", () => {
    const s = league([game("pre1", { phase: "PRE", broadcast: bc })]);
    archiveSeasonGames(s);
    s.games = []; // as the rollover does; lookups now come from the archive
    expect(findGame(s, "pre1")?.broadcast).toBeUndefined();
    expect(findGame(s, "pre1")?.phase).toBe("PRE");
    for (let y = 1; y <= ARCHIVE_PRESEASONS_KEPT + 1; y++) {
      s.season = 2026 + y;
      s.games = [game(`pre-y${y}`, { phase: "PRE" }), game(`reg-y${y}`)];
      archiveSeasonGames(s);
    }
    const preSeasons = new Set(s.gameArchive!.filter((g) => g.phase === "PRE").map((g) => g.season));
    expect(preSeasons.size).toBe(ARCHIVE_PRESEASONS_KEPT);
    expect(findGame(s, "reg-y1")).toBeDefined(); // real games outlive the preseason cap
    expect(findGame(s, "pre1")).toBeUndefined();
  });

  it("tags games with the season they were played in (archive before the year turns)", () => {
    const s = league([game("g")]);
    archiveSeasonGames(s);
    s.season += 1;
    expect(s.gameArchive![0]!.season).toBe(2026);
  });

  it("online, an archived game goes only to the GMs who had revealed it", () => {
    const s = league([
      game("pre-seen", { phase: "PRE", week: 1 }),
      game("pre-unseen", { phase: "PRE", week: 3 }),
      game("reg-seen", { week: 2 }),
      game("sb", { phase: "SB", week: 0 }),
    ]);
    s.gms = [
      { id: "a", isHuman: true, teamCode: "BUF" },
      { id: "b", isHuman: true, teamCode: "NYJ" },
    ] as never;
    markRevealed(s, "a", "PRE", 2);
    markRevealed(s, "a", "REG", 2);
    markRoundRevealed(s, "a", "SB");
    markRevealed(s, "b", "PRE", 3);
    archiveSeasonGames(s, { gated: true, only: "PRE" });
    s.games = [];
    s.games = [game("reg-seen", { week: 2 }), game("sb", { phase: "SB", week: 0 })];
    archiveSeasonGames(s, { gated: true });
    const ids = (gm: string) => visibleArchive(s.gameArchive, gm).map((g) => g.id).sort();
    expect(ids("a")).toEqual(["pre-seen", "reg-seen", "sb"]);
    // b watched all of preseason but nothing of the regular season or playoffs
    expect(ids("b")).toEqual(["pre-seen", "pre-unseen"]);
    // a commissioner with no franchise sees none of a gated archive
    expect(ids("")).toEqual([]);
    // and a solo archive (no `seenBy`) is open to its one GM
    const solo = league([game("x")]);
    archiveSeasonGames(solo);
    expect(visibleArchive(solo.gameArchive, "anyone")).toHaveLength(1);
  });

  it("never hands a GM another GM's viewing record", () => {
    const s = league([game("g1", { week: 1 })]);
    s.gms = [{ id: "a", isHuman: true, teamCode: "BUF" }, { id: "b", isHuman: true, teamCode: "NYJ" }] as never;
    markRevealed(s, "a", "REG", 1);
    archiveSeasonGames(s, { gated: true });
    expect(s.gameArchive![0]!.seenBy).toEqual(["a"]);
    const out = visibleArchive(s.gameArchive, "a");
    expect(out).toHaveLength(1);
    expect("seenBy" in out[0]!).toBe(false);
    expect(JSON.stringify(out)).not.toContain("seenBy");
    expect(s.gameArchive![0]!.seenBy).toEqual(["a"]); // the stored entry is untouched
  });

  it("keeps who-saw-what across save/reload and later seasons", () => {
    const s = league([game("y1-seen", { week: 1 }), game("y1-unseen", { week: 5 })]);
    s.gms = [{ id: "a", isHuman: true, teamCode: "BUF" }, { id: "b", isHuman: true, teamCode: "NYJ" }] as never;
    markRevealed(s, "a", "REG", 2);
    archiveSeasonGames(s, { gated: true });
    // save and reload, then play another season and roll over again
    const reloaded = JSON.parse(JSON.stringify(s)) as LeagueState;
    reloaded.season = 2027;
    reloaded.games = [game("y2", { week: 1 })];
    reloaded.reveal = emptyReveal();
    markRevealed(reloaded, "b", "REG", 1);
    archiveSeasonGames(reloaded, { gated: true });
    const ids = (gm: string) => visibleArchive(reloaded.gameArchive, gm).map((g) => g.id).sort();
    expect(ids("a")).toEqual(["y1-seen"]); // year two's game was only revealed by b
    expect(ids("b")).toEqual(["y2"]);
    expect(ids("a")).not.toContain("y1-unseen");
    // re-archiving the same year later cannot widen who may see a game
    reloaded.games = [game("y1-unseen", { week: 5 })];
    markRevealed(reloaded, "a", "REG", 9);
    archiveSeasonGames(reloaded, { gated: true });
    expect(ids("a")).not.toContain("y1-unseen");
  });
});
