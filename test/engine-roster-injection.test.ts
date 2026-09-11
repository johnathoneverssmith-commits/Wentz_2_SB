import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Player } from "../src/schema/player.js";
import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { Roster } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

const hasPool = existsSync(LOCAL_POOL_PATH);

/**
 * `simulateGame`'s `homeRoster`/`awayRoster` override — lets a caller (the
 * franchise-UI adapter) sim a game against a specific roster pair (e.g. a
 * franchise's own post-trade/draft/re-signing players) instead of the
 * file-backed `roster(team)` pool. Pool-free: builds its own rosters, so it
 * runs everywhere.
 */

function fakePlayer(id: string, name: string, position: string, team: string): Player {
  return {
    id,
    name,
    position,
    age: 26,
    nfl_team: team,
    years_pro: 4,
    overall: 80,
    attributes: {},
    scheme_tags: [],
    dev_age_threshold: 24,
    decline_age_threshold: 30,
    injury_history: [],
    contract: null,
    free_agent: false,
    injury_status: null,
    retired: false,
  } as unknown as Player;
}

function customRoster(team: string, qbName: string): Roster {
  const players: Player[] = [
    fakePlayer(`${team}_qb`, qbName, "QB", team),
    fakePlayer(`${team}_rb`, `${team} Runner`, "RB", team),
    fakePlayer(`${team}_wr1`, `${team} Target One`, "WR", team),
    fakePlayer(`${team}_wr2`, `${team} Target Two`, "WR", team),
    fakePlayer(`${team}_wr3`, `${team} Target Three`, "WR", team),
    fakePlayer(`${team}_te`, `${team} End`, "TE", team),
    fakePlayer(`${team}_lt`, `${team} LT`, "OT", team),
    fakePlayer(`${team}_rt`, `${team} RT`, "OT", team),
    fakePlayer(`${team}_lg`, `${team} LG`, "OG", team),
    fakePlayer(`${team}_rg`, `${team} RG`, "OG", team),
    fakePlayer(`${team}_c`, `${team} C`, "C", team),
    fakePlayer(`${team}_edge1`, `${team} Edge One`, "EDGE", team),
    fakePlayer(`${team}_edge2`, `${team} Edge Two`, "EDGE", team),
    fakePlayer(`${team}_dt1`, `${team} DT One`, "DT", team),
    fakePlayer(`${team}_dt2`, `${team} DT Two`, "DT", team),
    fakePlayer(`${team}_ilb1`, `${team} ILB One`, "ILB", team),
    fakePlayer(`${team}_ilb2`, `${team} ILB Two`, "ILB", team),
    fakePlayer(`${team}_cb1`, `${team} CB One`, "CB", team),
    fakePlayer(`${team}_cb2`, `${team} CB Two`, "CB", team),
    fakePlayer(`${team}_cb3`, `${team} CB Three`, "CB", team),
    fakePlayer(`${team}_s1`, `${team} S One`, "S", team),
    fakePlayer(`${team}_s2`, `${team} S Two`, "S", team),
    fakePlayer(`${team}_k`, `${team} Kicker`, "K", team),
    fakePlayer(`${team}_p`, `${team} Punter`, "P", team),
  ];
  return new Roster(team, players);
}

describe("simulateGame roster injection", () => {
  it("uses the injected rosters instead of the file-backed pool", () => {
    const homeRoster = customRoster("KC", "Custom Home QB");
    const awayRoster = customRoster("BUF", "Custom Away QB");
    const g = simulateGame(7, "KC", "BUF", { trace: true, homeRoster, awayRoster });
    expect(g.playTrace).toBeTruthy();
    const trace = g.playTrace!;
    expect(trace.length).toBeGreaterThan(20);

    const homePassers = trace.filter((r) => r.team === 0 && r.passer).map((r) => r.passer);
    const awayPassers = trace.filter((r) => r.team === 1 && r.passer).map((r) => r.passer);
    expect(homePassers.length).toBeGreaterThan(0);
    expect(awayPassers.length).toBeGreaterThan(0);
    expect(homePassers.every((n) => n === "Custom Home QB")).toBe(true);
    expect(awayPassers.every((n) => n === "Custom Away QB")).toBe(true);
  });

  it("is deterministic for a fixed seed + roster pair", () => {
    const roster = (team: string, qb: string) => customRoster(team, qb);
    const run = () =>
      simulateGame(11, "KC", "BUF", {
        trace: true,
        homeRoster: roster("KC", "Home QB"),
        awayRoster: roster("BUF", "Away QB"),
      });
    const a = run();
    const b = run();
    expect(a.score).toEqual(b.score);
    expect(a.playTrace).toEqual(b.playTrace);
  });

  it.runIf(hasPool)("falls back to the file-backed pool when no override is given (unchanged behaviour)", () => {
    // no homeRoster/awayRoster — same call shape as before this change
    const g = simulateGame(7, "KC", "BUF");
    expect(g.score).toHaveLength(2);
  });
});
