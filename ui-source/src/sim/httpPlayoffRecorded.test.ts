import { afterEach, describe, expect, it, vi } from "vitest";

import { HttpSimulationService } from "./HttpSimulationService.ts";

/** Contract: recorded games leave the UI in UI codes (LAR) and reach the engine in engine codes (LA). */
describe("playoffRound recorded-game contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("translates LAR to LA on the way out and returns UI codes", async () => {
    let sent: any = null;
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ games: [{ round: "divisional", home: "LA", away: "DET", winner: "LA", homeScore: 20, awayScore: 10, homeSeed: 4, awaySeed: 1, conference: "NFC" }], boxes: {}, nextRoundPreview: null, done: false, champion: null }), { status: 200 });
    }));
    const raw = (seeds: string[]) => ({ seeds, divisionWinners: [], wildCards: [] });
    const res = await new HttpSimulationService().playoffRound(
      1,
      { AFC: raw(["KC", "BUF", "BAL", "HOU", "LAC", "PIT", "DEN"]), NFC: raw(["DET", "PHI", "TB", "LAR", "MIN", "GB", "SEA"]) },
      1, {}, {}, 1, {}, 0, null, {},
      [{ round: "wildcard", home: "LAR", away: "SEA", homeScore: 24, awayScore: 17, winner: "LAR" }],
    );
    expect(sent.recorded).toEqual([{ round: "wildcard", home: "LA", away: "SEA", homeScore: 24, awayScore: 17, winner: "LA" }]);
    expect(sent.seeding.NFC.seeds[3]).toBe("LA");
    expect(res.games[0]!.home).toBe("LAR");
    expect(res.games[0]!.winner).toBe("LAR");
  });
});
