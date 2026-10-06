import { expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { simulateBlock } from "../src/blocks.js";

/**
 * A playthrough reported the whole league at 0 passing yards. Whatever the
 * cause, a simulated week must never get there quietly: one real week through
 * the block path the server runs, checked at every place a passing yard is
 * kept — the game's team totals, the player lines, and the season stats.
 */
it("a simulated week throws the ball, and every stat layer records it", () => {
  const s = createLeague(9090, { ...DEFAULT_CONFIG });
  fillRosterGaps(s);
  if (!s.schedule?.length) s.schedule = new MockSimulationService().generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  const played = simulateBlock(s, "REG", 1, 1);
  expect(played).toBeGreaterThan(10);

  const games = s.games.filter((g) => g.phase === "REG" && g.week === 1);
  const teamGames = games.length * 2;
  const teamPass = games.reduce((n, g) => n + (g.totals?.home.passYards ?? 0) + (g.totals?.away.passYards ?? 0), 0);
  const teamRush = games.reduce((n, g) => n + (g.totals?.home.rushYards ?? 0) + (g.totals?.away.rushYards ?? 0), 0);
  // the NFL: ~215 net passing and ~115 rushing yards a team-game
  expect(teamPass / teamGames).toBeGreaterThan(150);
  expect(teamPass).toBeGreaterThan(teamRush);

  const players = Object.values(s.players);
  const playerPass = players.reduce((n, p) => n + (p.season_stats?.passYds ?? 0), 0);
  const playerRec = players.reduce((n, p) => n + (p.season_stats?.recYds ?? 0), 0);
  expect(playerPass / teamGames).toBeGreaterThan(150);
  expect(playerRec).toBe(playerPass);
  // every team had a passer who threw
  for (const code of new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))) {
    const thrown = players.filter((p) => p.nfl_team === code).reduce((n, p) => n + (p.season_stats?.passAtt ?? 0), 0);
    expect(thrown, code).toBeGreaterThan(15);
  }
});
