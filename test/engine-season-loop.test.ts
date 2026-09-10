import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import {
  finishSeason,
  playThroughWeek,
  playWeek,
  progressClinches,
  progressStandings,
  regularSeasonComplete,
  remainingOpponents,
  simulateNflSeason,
  startSeason,
} from "../src/engine/season.js";

/**
 * Phase A1: the week-by-week season loop the interactive franchise UI drives.
 * Structural checks are pool-free; the equivalence-to-`simulateNflSeason` and
 * determinism checks need the generated pool.
 */

describe("season loop — structure (pool-free)", () => {
  const p0 = startSeason(7, { year: 2026 });

  it("starts before week 1 with the full slate and no results", () => {
    expect(p0.nextWeek).toBe(1);
    expect(p0.results).toHaveLength(0);
    expect(p0.schedule).toHaveLength(272);
    expect(regularSeasonComplete(p0)).toBe(false);
  });

  it("lists 17 remaining opponents per team at kickoff", () => {
    for (const t of NFL_TEAMS) {
      const opps = remainingOpponents(p0, t);
      expect(opps).toHaveLength(17);
      // home/away encoding: "@X" = away, "X" = home
      const codes = opps.map((o) => o.replace("@", ""));
      expect(new Set(codes).size).toBeGreaterThanOrEqual(13); // ≥13 distinct (3 rivals twice)
      for (const c of codes) expect(NFL_TEAMS).toContain(c);
    }
  });

  it("playThroughWeek only advances the pointer it is given (no sim past it)", () => {
    // playThroughWeek(0) is a no-op; can't check sim without a pool, but the
    // pointer math must be right
    expect(playThroughWeek(p0, 0).nextWeek).toBe(1);
  });
});

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("season loop — with the pool", () => {
  it("week-by-week reaches the same result as simulateNflSeason", { timeout: 240_000 }, () => {
    let p = startSeason(11, { year: 2026 });
    let weeksPlayed = 0;
    while (!regularSeasonComplete(p)) {
      const step = playWeek(p);
      p = step.progress;
      weeksPlayed += 1;
      // every week 5–14 may have byes; 1–4 and 15–18 are full 16-game slates
      if (weeksPlayed <= 4 || weeksPlayed >= 15) expect(step.games).toHaveLength(16);
    }
    expect(weeksPlayed).toBe(18);
    expect(p.results).toHaveLength(272);

    const incremental = finishSeason(p);
    const oneShot = simulateNflSeason(11, { year: 2026 });
    expect(incremental.games).toEqual(oneShot.games);
    expect(incremental.standings.seeding).toEqual(oneShot.standings.seeding);
    expect(incremental.champion).toBe(oneShot.champion);
  });

  it("progressStandings / progressClinches work mid-season", { timeout: 180_000 }, () => {
    const p = playThroughWeek(startSeason(3, { year: 2026 }), 10);
    expect(p.nextWeek).toBe(11);
    expect(p.results.length).toBeGreaterThan(140);

    const standings = progressStandings(p);
    expect(standings.rows).toHaveLength(32);
    for (const r of standings.rows) expect(r.games).toBeGreaterThanOrEqual(8);

    const clinch = progressClinches(p);
    expect(clinch).toHaveLength(32);
    // nobody clinches a berth by week 10 in a normal sim; nobody contradicts
    for (const c of clinch) {
      expect(c.tags.includes("berth") && c.tags.includes("eliminated")).toBe(false);
    }
  });

  it("playWeek is a pure step — the input progress is unchanged", { timeout: 120_000 }, () => {
    const p = startSeason(5, { year: 2026 });
    const before = p.results.length;
    const step = playWeek(p);
    expect(p.results.length).toBe(before); // not mutated
    expect(p.nextWeek).toBe(1);
    expect(step.progress.nextWeek).toBe(2);
    expect(step.games).toHaveLength(16);
  });
});
