import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { broadcastGame } from "../../src/engine/broadcast.js";
import { analyzeGame } from "../../src/engine/highlights.js";
import { type RecapSource, buildRecap } from "../../src/engine/recap.js";
import { Roster } from "../../src/engine/roster.js";
import { simulateGame } from "../../src/engine/sim.js";
import { presentGame } from "../../server/simGame.js";
import type { Player } from "../../src/schema/player.js";
import { boxScoreOf, trimStoredBoxScores } from "../src/boxscore.js";

import type { GameResult } from "@/domain";

/**
 * A single-player game is presented by the adapter and an online one by
 * `boxScoreOf`. The recap reads only the stored record, so two records of the
 * same game must give the same recap, and an online record trimmed of its
 * player lines (it keeps them for human teams' games only) must still give
 * the same result and story.
 */
const pool = JSON.parse(readFileSync(new URL("../../ui-source/src/data/pool-2026.json", import.meta.url), "utf8")) as Player[];
const squad = (team: string): Player[] => pool.filter((p) => p.nfl_team === team);

describe("recaps of equivalent single-player and online records", () => {
  it("are identical, with and without the play-by-play, overtime included", () => {
    const pairs: [string, string][] = [["KC", "BUF"], ["SF", "DAL"], ["PHI", "DET"]];
    let games = 0;
    let withBroadcast = 0;
    for (let seed = 1; seed <= 12; seed++)
      for (const [home, away] of pairs) {
        const opts = { homeRoster: new Roster(home, squad(home)), awayRoster: new Roster(away, squad(away)), overtime: "nfl" } as const;
        const g = simulateGame(seed, home, away, { ...opts, trace: true, injuries: true });
        const local = presentGame(g, { homeTeam: home, awayTeam: away, week: 4, weather: null, players: { [home]: squad(home), [away]: squad(away) } });
        const online = boxScoreOf(g, home, away, 4, { home: squad(home) as never, away: squad(away) as never });
        const bc = broadcastGame(seed, home, away, opts);
        const where = `${away}@${home} seed ${seed}`;
        const base = { homeTeam: home, awayTeam: away, homeScore: g.score[0], awayScore: g.score[1], phase: "REG", week: 4 };
        const a: RecapSource = { ...base, ...local, broadcast: bc } as RecapSource;
        const b: RecapSource = { ...base, ...(online as object), broadcast: bc } as RecapSource;
        expect(buildRecap(b), where).toEqual(buildRecap(a));
        // without the plays (a game the league did not keep them for)
        expect(buildRecap({ ...b, broadcast: undefined }), where).toEqual(buildRecap({ ...a, broadcast: undefined }));
        // the analysis of the same broadcast, saved and reloaded
        expect(analyzeGame(JSON.parse(JSON.stringify(bc))), where).toEqual(analyzeGame(bc));
        games++;
        withBroadcast += bc.drives.length > 0 ? 1 : 0;
      }
    expect(games).toBe(36);
    expect(withBroadcast).toBe(36);
  }, 180_000);

  it("an online game trimmed to its totals still gets the same result and the same story, without standouts", () => {
    const [home, away] = ["KC", "BUF"] as const;
    const g = simulateGame(7, home, away, { homeRoster: new Roster(home, squad(home)), awayRoster: new Roster(away, squad(away)), trace: true, injuries: true, overtime: "nfl" });
    const online = boxScoreOf(g, home, away, 4, { home: squad(home) as never, away: squad(away) as never });
    const full = { id: "x", week: 4, phase: "REG", homeTeam: home, awayTeam: away, played: true, homeScore: g.score[0], awayScore: g.score[1], ...online } as unknown as GameResult;
    const kept = buildRecap(full as unknown as RecapSource);
    const copy = JSON.parse(JSON.stringify(full)) as GameResult;
    trimStoredBoxScores([copy], new Set()); // no human team in this game: lines and scoring summary are dropped
    const trimmed = buildRecap(copy as unknown as RecapSource);
    expect(trimmed.headline.split(" ")[0]).toBe(kept.headline.split(" ")[0]); // the same winner leads the headline
    expect(trimmed.paragraphs[0]).toBe(kept.paragraphs[0]);
    expect(trimmed.standouts).toEqual([]);
    expect(trimmed.basis).toBe("final_score");
    // the trimmed record has no scoring summary to read the lead from, so it claims none
    expect(trimmed.facts).toEqual({ ...kept.facts, leadChanges: 0, winnerTrailedBy: null });
  });
});
