import { describe, expect, it } from "vitest";

import { useStore } from "./store.ts";

describe("game history and replacing the league", () => {
  it("starting a new league does not inherit the old league's archive", async () => {
    useStore.setState((s) => {
      s.gameArchive = [{ id: "old", week: 1, phase: "REG", homeTeam: "GB", awayTeam: "CHI", played: true, homeScore: 1, awayScore: 0, season: 2020 }];
    });
    expect(useStore.getState().gameArchive).toHaveLength(1);
    await useStore.getState().newLeague(9);
    expect(useStore.getState().gameArchive ?? []).toEqual([]);
  });

  it("a league arriving whole from outside (online fetch, backup restore) without an archive clears it", () => {
    useStore.setState((s) => {
      s.gameArchive = [{ id: "old", week: 1, phase: "REG", homeTeam: "GB", awayTeam: "CHI", played: true, homeScore: 1, awayScore: 0, season: 2020 }];
    });
    const whole = { ...useStore.getState() } as Record<string, unknown>;
    delete whole.gameArchive;
    useStore.setState(whole as never);
    expect(useStore.getState().gameArchive ?? []).toEqual([]);
  });
});
