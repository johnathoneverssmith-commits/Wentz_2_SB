import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";

import {
  createLeague,
  DEFAULT_CONFIG,
  forgetOldRetirees,
  pruneFreeAgentMarket,
} from "./seed.ts";

/**
 * Nothing ever left the free-agent market. Every offseason added a draft
 * class, the contracts that ran out, and the camp bodies the roster fill
 * generated — five seasons in there were 1,072 free agents against 1,696
 * roster spots, a board nobody could read and a save carrying 2,930 players.
 */
function marketOf(s: LeagueState): Player[] {
  return Object.values(s.players).filter((p) => p.free_agent && !p.retired);
}

function fixture(marketSize: number): LeagueState {
  const s = createLeague(5, DEFAULT_CONFIG);
  const all = Object.values(s.players);
  for (const p of all) {
    p.free_agent = false;
    p.nfl_team = "KC";
  }
  for (const p of all.slice(0, marketSize)) {
    p.free_agent = true;
    p.nfl_team = "FA";
    p.contract = null;
  }
  return s;
}

describe("free agent market pruning", () => {
  it("leaves a market that's already a sensible size alone", () => {
    const s = fixture(120);
    pruneFreeAgentMarket(s);
    expect(marketOf(s)).toHaveLength(120);
  });

  it("brings an overgrown market back to the ceiling", () => {
    const s = fixture(900);
    pruneFreeAgentMarket(s);
    expect(marketOf(s).length).toBeLessThanOrEqual(320);
    expect(marketOf(s).length).toBeGreaterThan(300);
  });

  it("keeps the useful half — a GM looking for a starter still finds one", () => {
    const s = fixture(900);
    const bestBefore = Math.max(...marketOf(s).map((p) => p.overall));
    pruneFreeAgentMarket(s);
    expect(Math.max(...marketOf(s).map((p) => p.overall))).toBe(bestBefore);
  });

  it("retires the worst, not a random slice", () => {
    const s = fixture(900);
    const before = marketOf(s);
    const cutoff = [...before].sort((a, b) => b.overall - a.overall)[319]!.overall;
    pruneFreeAgentMarket(s);
    for (const p of marketOf(s)) expect(p.overall).toBeGreaterThanOrEqual(cutoff - 20);
  });

  it("never touches a player who is on a roster", () => {
    const s = fixture(900);
    const rostered = Object.values(s.players).filter((p) => !p.free_agent).map((p) => p.id);
    pruneFreeAgentMarket(s);
    for (const id of rostered) expect(s.players[id]!.retired).toBe(false);
  });

  it("drops the retired from the standing-market list", () => {
    const s = fixture(900);
    s.standingFreeAgents = marketOf(s).map((p) => p.id);
    pruneFreeAgentMarket(s);
    for (const id of s.standingFreeAgents) expect(s.players[id]!.retired).toBe(false);
  });
});

/**
 * Retired players were kept forever. Nothing reads them — `history` scores
 * GMs, not players, and every screen filters them out — but the save grows
 * ~300 records a season at ~760 bytes each, and zustand's `persist` fails
 * *silently* when localStorage runs out: a dynasty would have quietly stopped
 * saving somewhere around its fifteenth year.
 */
describe("forgetting old retirees", () => {
  function withRetirees(currentSeason: number): LeagueState {
    const s = createLeague(9, DEFAULT_CONFIG);
    s.season = currentSeason;
    const all = Object.values(s.players);
    all[0]!.retired = true;
    all[0]!.retired_season = currentSeason; // this year
    all[1]!.retired = true;
    all[1]!.retired_season = currentSeason - 1; // last year
    all[2]!.retired = true;
    all[2]!.retired_season = currentSeason - 4; // long gone
    all[3]!.retired = true; // from a save written before the field existed
    return s;
  }

  it("keeps this year's and last year's, drops the rest", () => {
    const s = withRetirees(2030);
    const ids = Object.values(s.players).filter((p) => p.retired).map((p) => p.id);
    forgetOldRetirees(s);
    expect(s.players[ids[0]!]).toBeDefined();
    expect(s.players[ids[1]!]).toBeDefined();
    expect(s.players[ids[2]!]).toBeUndefined();
  });

  it("drops a retiree from an older save that has no season stamped", () => {
    const s = withRetirees(2030);
    const unstamped = Object.values(s.players).find((p) => p.retired && !p.retired_season)!;
    forgetOldRetirees(s);
    expect(s.players[unstamped.id]).toBeUndefined();
  });

  it("never drops an active player", () => {
    const s = withRetirees(2030);
    const active = Object.values(s.players).filter((p) => !p.retired).map((p) => p.id);
    forgetOldRetirees(s);
    for (const id of active) expect(s.players[id]).toBeDefined();
  });

  it("leaves no dangling id on the standing-market list", () => {
    const s = withRetirees(2030);
    s.standingFreeAgents = Object.keys(s.players);
    forgetOldRetirees(s);
    for (const id of s.standingFreeAgents) expect(s.players[id]).toBeDefined();
  });
});
