import { describe, expect, it } from "vitest";

import { loadPool, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";
import { allStaffs } from "../src/engine/staff-data.js";
import * as boxscoreMapShim from "../server/boxscore-map.js";
import * as simGameShim from "../server/simGame.js";
import * as service from "../src/sim-service/index.js";
import { boxScoreParts, handlePlayoffGame, handlePlayoffRound, hashStr, presentGame, simulateOne, simulateWeek, type GameInput } from "../src/sim-service/index.js";
import type { Player } from "../src/schema/player.js";
import { weatherFor } from "../src/engine/weather.js";
import { cleanPlan } from "../src/engine/gameplan.js";

/**
 * Issue #74 Phase 3: the week/playoff request handlers and the box-score
 * presentation live in `src/sim-service`, shared by the local adapter
 * (`server/`), the online server and, later, a browser worker. These pin the
 * parts a host relies on; the adapter's byte-identity is checked separately
 * against its HTTP responses.
 */
const pool = loadPool();
const playersOf = (t: string): Player[] => [...(pool.get(t) ?? [])];

describe("simulateWeek", () => {
  const games = [
    { homeTeam: "KC", awayTeam: "BUF" },
    { homeTeam: "SF", awayTeam: "DAL" },
  ];
  const teams = games.flatMap((g) => [g.homeTeam, g.awayTeam]);
  const staffs = allStaffs();
  const plan = cleanPlan({ passRate: 8, fourthRedZone: 40, fourthOpp: 10, fourthOwn: -20, blitz: 30, p11: 60, p12: 30, p13: 10 });
  const body = {
    seed: 12,
    season: 2026,
    week: 5,
    phase: "REG" as const,
    games,
    viewer: games[1]!,
    talentScale: 1.5,
    offenseAdjust: 0.5,
    rosters: Object.fromEntries(teams.map((t) => [t, playersOf(t)])),
    depthCharts: { KC: { QB: [playersOf("KC").find((p) => p.position === "QB")!.id] } },
    staffs: Object.fromEntries(teams.map((t) => [t, staffs[t]!])),
    plans: { KC: plan, DAL: plan },
  };

  it("hands the runner one input per game, mapped from the request by the documented rules", async () => {
    const seen: GameInput[] = [];
    await simulateWeek(body, (i) => (seen.push(i), simulateOne(i)));
    expect(seen).toHaveLength(2);
    const [a, b] = seen as [GameInput, GameInput];
    expect(a.gameSeed).toBe(hashStr("12|5|REG|KC|BUF"));
    expect(b.gameSeed).toBe(hashStr("12|5|REG|SF|DAL"));
    expect([a.isViewer, b.isViewer]).toEqual([false, true]);
    expect(a).toMatchObject({ season: 2026, week: 5, phase: "REG", homeTeam: "KC", awayTeam: "BUF", talentScale: 1.5, offenseAdjust: 0.5 });
    expect(a.homePlayers).toBe(body.rosters.KC);
    expect(a.awayPlayers).toBe(body.rosters.BUF);
    expect(a.homeDepth).toBe(body.depthCharts.KC);
    expect(a.awayDepth).toBeUndefined();
    expect(a.homeStaff).toBe(body.staffs.KC);
    expect(a.homePlan).toBe(plan);
    expect(a.awayPlan).toBeUndefined();
    expect(b.awayPlan).toBe(plan);
  });

  it("is the same week whether the runner is sync, async, or reordered in time", async () => {
    const inline = await simulateWeek(body, simulateOne);
    const asyncRun = await simulateWeek(body, async (i) => {
      await new Promise((r) => setTimeout(r, i.homeTeam === "KC" ? 20 : 0));
      return simulateOne(i);
    });
    expect(asyncRun).toEqual(inline);
    expect(inline.map((g) => `${g.homeTeam}@${g.awayTeam}`)).toEqual(["KC@BUF", "SF@DAL"]);
    expect("broadcast" in inline[0]!).toBe(false);
    expect("broadcast" in inline[1]!).toBe(true);
  });

  it("a request with no franchise data plays the reference rosters with no staffs or plans", async () => {
    const [g] = await simulateWeek({ seed: 1, week: 2, phase: "PRE", games: [games[0]!] }, simulateOne);
    const seed = hashStr("1|2|PRE|KC|BUF");
    const direct = simulateGame(seed, "KC", "BUF", { trace: true, injuries: true, overtime: "nfl", weather: weatherFor("KC", "PRE", 2, seed) });
    expect([g!.homeScore, g!.awayScore]).toEqual([direct.score[0], direct.score[1]]);
  });
});

describe("box score presentation", () => {
  const seed = hashStr("box|1");
  const g = simulateGame(seed, "KC", "BUF", { trace: true, injuries: true, overtime: "nfl", weather: weatherFor("KC", "REG", 3, seed) });
  const players = { KC: playersOf("KC"), BUF: playersOf("BUF") };

  it("presentGame is boxScoreParts plus injuries and weather, keys in the order the UI has always had", () => {
    const parts = boxScoreParts(g, "KC", "BUF", 3, players);
    const shown = presentGame(g, { homeTeam: "KC", awayTeam: "BUF", week: 3, weather: g.weather, players });
    expect(Object.keys(shown)).toEqual(["totals", "scoringPlays", "playerLines", "injuries", "weather"]);
    expect({ totals: shown.totals, scoringPlays: shown.scoringPlays, playerLines: shown.playerLines }).toEqual(parts);
  });
});

describe("playoff handlers", () => {
  // any 14 teams will do: the stepper only needs seeds per conference
  const mk = (seeds: string[]) => ({ seeds, divisionWinners: seeds.slice(0, 4), wildCards: seeds.slice(4), order: seeds });
  const t14 = teamList().slice(0, 14);
  const seeding = { AFC: mk(t14.slice(0, 7)), NFC: mk(t14.slice(7)) };
  const [home, away] = [seeding.AFC.seeds[0]!, seeding.NFC.seeds[0]!];
  const all = [...seeding.AFC.seeds, ...seeding.NFC.seeds];
  const rosters = Object.fromEntries(all.map((t) => [t, playersOf(t)]));

  it("a round is a pure function of its body, and the viewer's game carries the broadcast", () => {
    const body = { seed: 21, seeding, roundsPlayed: 0, rosters, viewerTeam: home } as unknown as Parameters<typeof handlePlayoffRound>[0];
    const a = handlePlayoffRound(body);
    expect(handlePlayoffRound(body)).toEqual(a);
    expect(a.games.length).toBe(6);
    expect(Object.keys(a.boxes)).toHaveLength(6);
    const withBroadcast = Object.entries(a.boxes).filter(([, v]) => "broadcast" in (v as object)).map(([k]) => k);
    expect(withBroadcast.every((k) => k.includes(home))).toBe(true);
  });

  it("a single decided game is never tied and returns its box", () => {
    const r = handlePlayoffGame({ seed: 31, homeTeam: home, awayTeam: away, neutralSite: true, rosters, viewerTeam: home });
    expect(r.homeScore).not.toBe(r.awayScore);
    expect(r.box).not.toBeNull();
  });
});

describe("the paths that predate the move still resolve to the same code", () => {
  it("server/simGame and server/boxscore-map re-export the shared module", () => {
    expect(simGameShim.presentGame).toBe(service.presentGame);
    expect(simGameShim.simulateOne).toBe(service.simulateOne);
    expect(boxscoreMapShim.playerLinesFrom).toBe(service.playerLinesFrom);
    expect(boxscoreMapShim.scoringPlaysFrom).toBe(service.scoringPlaysFrom);
  });
});
