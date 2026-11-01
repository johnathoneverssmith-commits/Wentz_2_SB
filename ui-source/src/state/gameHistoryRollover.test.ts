import { describe, expect, it } from "vitest";

import { findGame } from "./gameHistory.ts";
import { DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";
import { useStore } from "./store.ts";

const s = () => useStore.getState();

describe("game history across the real season rollover", () => {
  it("moves the year's games into the archive, tagged with their own season, then clears the live list", async () => {
    await useStore.getState().newLeague(5, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const year = s().season;
    useStore.setState((d) => {
      d.gms[0]!.teamCode = "GB";
      d.teams.GB!.controlledBy = { kind: "human", gmId: d.gms[0]!.id };
      fillRosterGaps(d as never);
      const mk = (id: string, phase: "PRE" | "REG" | "SB", home: string, away: string) =>
        ({ id, week: 1, phase, homeTeam: home, awayTeam: away, played: true, homeScore: 24, awayScore: 17, scoringPlays: [{ quarter: 1, team: home, description: "TD", homeScore: 7, awayScore: 0 }] }) as never;
      d.games = [mk("pre", "PRE", "GB", "CHI"), mk("reg", "REG", "DAL", "GB"), mk("sb", "SB", "GB", "KC"), mk("cpu", "REG", "DAL", "NYG")];
      d.stage = "offseasonDepthChart";
    });
    s().autoReadyNonViewers();
    s().setReady(s().viewerGmId, true);
    await useStore.getState().tryAdvance();
    expect(s().stage).toBe("preseason");
    expect(s().season).toBe(year + 1);
    expect(s().games.find((g) => g.id === "reg")).toBeUndefined();
    for (const id of ["pre", "reg", "sb"]) expect(findGame(s(), id)?.played, id).toBe(true);
    expect(findGame(s(), "cpu"), "a game no human played is not archived").toBeUndefined();
    expect(new Set(s().gameArchive!.map((g) => g.season))).toEqual(new Set([year]));
    expect(findGame(s(), "reg")?.scoringPlays).toHaveLength(1);
  });
});
