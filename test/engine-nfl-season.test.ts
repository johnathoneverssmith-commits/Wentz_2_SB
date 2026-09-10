import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { NFL_TEAMS, conferenceOf } from "../src/engine/nfl-structure.js";
import { simulateNflSeason } from "../src/engine/season.js";

/**
 * Phase A1 integration: the real schedule → standings → playoff bracket, run
 * once through the engine. Needs the generated pool (every team needs a
 * roster), so it is skipped on a bare checkout.
 */

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("simulateNflSeason", () => {
  const season = simulateNflSeason(7, { year: 2025 });

  it("plays a 272-game regular season, 17 per team over 18 weeks", () => {
    expect(season.games).toHaveLength(272);
    const gp = new Map<string, number>(NFL_TEAMS.map((t) => [t, 0]));
    const weeks = new Set<number>();
    for (const g of season.games) {
      gp.set(g.home, gp.get(g.home)! + 1);
      gp.set(g.away, gp.get(g.away)! + 1);
      weeks.add(g.week);
    }
    for (const t of NFL_TEAMS) expect(gp.get(t)).toBe(17);
    expect([...weeks].sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("produces internally consistent standings (ΣW = ΣL, PF = PA)", () => {
    let w = 0;
    let l = 0;
    let pf = 0;
    let pa = 0;
    for (const r of season.standings.rows) {
      expect(r.games).toBe(17);
      expect(r.wins + r.losses + r.ties).toBe(17);
      w += r.wins;
      l += r.losses;
      pf += r.pointsFor;
      pa += r.pointsAgainst;
    }
    expect(w).toBe(l);
    expect(pf).toBe(pa);
    expect(season.standings.rows).toHaveLength(32);
  });

  it("seeds 7 per conference: 4 division winners then 3 wild cards", () => {
    for (const conf of ["AFC", "NFC"] as const) {
      const { seeds, divisionWinners, wildCards } = season.standings.seeding[conf];
      expect(seeds).toHaveLength(7);
      expect(new Set(seeds).size).toBe(7);
      expect(divisionWinners).toHaveLength(4);
      expect(wildCards).toHaveLength(3);
      expect(seeds).toEqual([...divisionWinners, ...wildCards]);
      for (const t of seeds) expect(conferenceOf(t)).toBe(conf);
      // division winners are seeds 1-4 even if a wild card has a better record
      for (const dw of divisionWinners) {
        const row = season.standings.rows.find((r) => r.team === dw)!;
        expect(row.wonDivision).toBe(true);
        expect(row.seed!).toBeLessThanOrEqual(4);
      }
    }
  });

  it("runs a 13-game bracket with the right shape", () => {
    const g = season.playoffs.games;
    expect(g).toHaveLength(13); // 3+3 wildcard, 2+2 divisional, 1+1 conference, 1 SB
    const count = (r: string) => g.filter((x) => x.round === r).length;
    expect(count("wildcard")).toBe(6);
    expect(count("divisional")).toBe(4);
    expect(count("conference")).toBe(2);
    expect(count("superbowl")).toBe(1);

    // #1 seeds get a bye — never appear in a wild-card game
    for (const conf of ["AFC", "NFC"] as const) {
      const one = season.standings.seeding[conf].seeds[0]!;
      const inWc = g.some((x) => x.round === "wildcard" && (x.home === one || x.away === one));
      expect(inWc).toBe(false);
    }

    // higher seed hosts every non-Super-Bowl game
    for (const x of g) {
      if (x.round === "superbowl") continue;
      expect(x.homeSeed).toBeLessThan(x.awaySeed);
    }
    // no playoff game ends tied
    for (const x of g) expect(x.homeScore).not.toBe(x.awayScore);
  });

  it("crowns a champion who won the Super Bowl and made the playoffs", () => {
    const sb = season.playoffs.games.find((x) => x.round === "superbowl")!;
    expect(season.champion).toBe(sb.winner);
    expect([sb.home, sb.away]).toContain(season.champion);
    expect(Object.values(season.playoffs.conferenceChampions)).toContain(season.champion);
    const row = season.standings.rows.find((r) => r.team === season.champion)!;
    expect(row.madePlayoffs).toBe(true);
  });

  it("is deterministic in seed + year", { timeout: 180_000 }, () => {
    const again = simulateNflSeason(7, { year: 2025 });
    expect(again.champion).toBe(season.champion);
    expect(again.standings.seeding).toEqual(season.standings.seeding);
    expect(again.playoffs.games).toEqual(season.playoffs.games);
  });
}, 240_000);
