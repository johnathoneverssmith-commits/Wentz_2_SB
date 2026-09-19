import { describe, expect, it } from "vitest";

import type { GameResult, LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { markRevealed, markRoundRevealed, redactedGames } from "./reveal.ts";

/**
 * `redactedGames` is the fix for a real leak: the online server used to hand
 * a client's `/leagues/:id` request the entire `state.games` array, which
 * holds every game a block simulated — including weeks and playoff rounds
 * this GM has not revealed yet. `structuredClone`d and JSON-serialized, that
 * is next week's scores and the eventual Super Bowl champion sitting in the
 * network response the moment the page loads, regardless of what the UI
 * chooses to render from it.
 *
 * These pin the fix at the one layer this repo actually unit-tests directly
 * (there is no HTTP-level test harness for `online/src/index.ts`'s routes,
 * so a test that only exercised the route would need one built from
 * scratch): that the redaction function itself hides exactly what it should
 * and nothing else.
 */
function aGame(over: Partial<GameResult> = {}): GameResult {
  return {
    id: "g1",
    week: 1,
    phase: "REG",
    homeTeam: "KC",
    awayTeam: "BUF",
    played: true,
    homeScore: 24,
    awayScore: 17,
    ...over,
  };
}

function leagueWithGames(games: GameResult[]): LeagueState {
  const s = createLeague(9001, { ...DEFAULT_CONFIG, humanGmCount: 1 });
  fillRosterGaps(s);
  s.games = games;
  return s;
}

describe("redactedGames", () => {
  it("passes an already-revealed game through untouched", () => {
    const s = leagueWithGames([aGame({ id: "g1", week: 1 })]);
    markRevealed(s, "gm_you", "REG", 1);
    const [g] = redactedGames(s, "gm_you");
    expect(g).toEqual(aGame({ id: "g1", week: 1 }));
  });

  it("hides the result of a played game nobody has revealed yet", () => {
    const s = leagueWithGames([aGame({ id: "g1", week: 5, homeScore: 31, awayScore: 3 })]);
    // this GM has revealed nothing at all
    const [g] = redactedGames(s, "gm_you");
    expect(g.played).toBe(false);
    expect(g.homeScore).toBe(0);
    expect(g.awayScore).toBe(0);
    // but the fixture itself — who and when — is still there for the schedule
    expect(g.week).toBe(5);
    expect(g.homeTeam).toBe("KC");
    expect(g.awayTeam).toBe("BUF");
  });

  it("strips box-score detail along with the score", () => {
    const s = leagueWithGames([
      aGame({
        id: "g1",
        week: 3,
        totals: { home: {} as never, away: {} as never },
        scoringPlays: [{ quarter: 1, team: "KC", description: "TD", homeScore: 7, awayScore: 0 }],
        playerLines: { home: [], away: [] },
        injuries: [],
        sidelined: { home: [], away: [] },
      }),
    ]);
    const [g] = redactedGames(s, "gm_you");
    expect(g.totals).toBeUndefined();
    expect(g.scoringPlays).toBeUndefined();
    expect(g.playerLines).toBeUndefined();
    expect(g.injuries).toBeUndefined();
    expect(g.sidelined).toBeUndefined();
  });

  it("leaves an unplayed future game alone — there's nothing to hide", () => {
    const s = leagueWithGames([aGame({ id: "g2", week: 9, played: false, homeScore: 0, awayScore: 0 })]);
    const [g] = redactedGames(s, "gm_you");
    expect(g).toEqual(aGame({ id: "g2", week: 9, played: false, homeScore: 0, awayScore: 0 }));
  });

  it("reveals a playoff round's real result only once that round is marked seen", () => {
    const s = leagueWithGames([
      aGame({ id: "wc1", phase: "WC", week: 0, homeScore: 27, awayScore: 20 }),
    ]);
    expect(redactedGames(s, "gm_you")[0]!.played).toBe(false);
    markRoundRevealed(s, "gm_you", "WC");
    expect(redactedGames(s, "gm_you")[0]!.homeScore).toBe(27);
  });

  it("keeps different GMs' views independent", () => {
    const s = leagueWithGames([aGame({ id: "g1", week: 4, homeScore: 14, awayScore: 10 })]);
    markRevealed(s, "gm_a", "REG", 4);
    expect(redactedGames(s, "gm_a")[0]!.played).toBe(true);
    expect(redactedGames(s, "gm_b")[0]!.played).toBe(false);
  });
});
