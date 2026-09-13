import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";

import { createLeague, DEFAULT_CONFIG, pruneFreeAgentMarket } from "./seed.ts";

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
