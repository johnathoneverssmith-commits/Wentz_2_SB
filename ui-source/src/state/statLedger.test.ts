import { describe, expect, it } from "vitest";

import type { GameResult } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "./seed.ts";
import { accrueSeasonStats, rewindSeasonStats } from "./standings.ts";

/**
 * Online blocks are simulated whole before anyone watches them. A GM who has
 * watched through week 1 must see the season's stats as of week 1.
 */
describe("stat ledger", () => {
  it("rewinds a block's unwatched weeks off the season stats", () => {
    const s = createLeague(2, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const qb = Object.values(s.players).find((p) => p.position === "QB" && s.teams[p.nfl_team])!;
    const game = (week: number, yds: number): GameResult => ({
      id: `g${week}`,
      week,
      phase: "REG",
      homeTeam: qb.nfl_team,
      awayTeam: "LV",
      played: true,
      homeScore: 21,
      awayScore: 14,
      playerLines: {
        home: [{ playerId: qb.id, name: qb.name, position: "QB", passYds: yds, passTd: 2 }],
        away: [],
      },
    });
    s.statLedger = {};
    accrueSeasonStats(s, [game(1, 300)]);
    accrueSeasonStats(s, [game(2, 250)]);
    accrueSeasonStats(s, [game(3, 200)]);
    expect(qb.season_stats!.passYds).toBe(750);

    const view = structuredClone(s);
    rewindSeasonStats(view, 1);
    const seen = view.players[qb.id]!.season_stats!;
    expect(seen.passYds).toBe(300);
    expect(seen.passTd).toBe(2);
    expect(seen.gamesPlayed).toBe(1);
    // the league itself is untouched
    expect(qb.season_stats!.passYds).toBe(750);
  });
});
