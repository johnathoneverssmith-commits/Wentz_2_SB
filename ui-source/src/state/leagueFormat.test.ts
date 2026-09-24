import { describe, expect, it } from "vitest";

import {
  humansOnlyLeagueSize,
  humansOnlyRounds,
  playoffFieldSize,
  roundRobinSchedule,
  roundRobinSets,
  seasonShapeFor,
} from "./leagueFormat.ts";

const CODES = ["GB", "KC", "PIT", "SF", "DAL", "BAL", "PHI", "BUF"];

describe("humans-only league size", () => {
  it("rounds the GM count up to an even number, never below four", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(humansOnlyLeagueSize)).toEqual([4, 4, 4, 4, 6, 6, 8, 8]);
  });
});

describe("season length", () => {
  it("plays whole round robins nearest seventeen games", () => {
    // 4 teams: 3 a pass, 17/3 = 5.7 -> 6 passes; 6: 5 a pass -> 3; 8: 7 -> 2
    expect(roundRobinSets(4)).toBe(6);
    expect(roundRobinSets(6)).toBe(3);
    expect(roundRobinSets(8)).toBe(2);
    expect(seasonShapeFor("humansOnly", 4).regularSeasonWeeks).toBe(18);
    expect(seasonShapeFor("humansOnly", 6).regularSeasonWeeks).toBe(15);
    expect(seasonShapeFor("humansOnly", 8).regularSeasonWeeks).toBe(14);
  });

  it("puts the deadline mid-season, strictly inside it", () => {
    for (const n of [4, 6, 8]) {
      const s = seasonShapeFor("humansOnly", n);
      expect(s.deadlineWeek).toBeGreaterThanOrEqual(1);
      expect(s.deadlineWeek).toBeLessThan(s.regularSeasonWeeks);
    }
  });

  it("leaves the NFL format exactly as it was", () => {
    expect(seasonShapeFor("nfl", 32)).toEqual({ preseasonWeeks: 3, regularSeasonWeeks: 18, deadlineWeek: 9 });
  });
});

describe.each([4, 6, 8])("round robin for %i teams", (n) => {
  const teams = CODES.slice(0, n);
  const games = roundRobinSchedule(teams);
  const reg = games.filter((g) => g.phase === "REG");
  const shape = seasonShapeFor("humansOnly", n);

  it("gives every team exactly one game every week — full matchups, no byes", () => {
    for (let w = 1; w <= shape.regularSeasonWeeks; w++) {
      const week = reg.filter((g) => g.week === w);
      expect(week).toHaveLength(n / 2);
      const playing = week.flatMap((g) => [g.homeTeam, g.awayTeam]);
      expect(new Set(playing).size).toBe(n);
    }
    for (let w = 1; w <= shape.preseasonWeeks; w++) {
      const week = games.filter((g) => g.phase === "PRE" && g.week === w);
      expect(new Set(week.flatMap((g) => [g.homeTeam, g.awayTeam])).size).toBe(n);
    }
  });

  it("has every pair meet once per pass", () => {
    const sets = roundRobinSets(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const met = reg.filter(
          (g) =>
            (g.homeTeam === teams[i] && g.awayTeam === teams[j]) ||
            (g.homeTeam === teams[j] && g.awayTeam === teams[i]),
        );
        expect(met, `${teams[i]} v ${teams[j]}`).toHaveLength(sets);
      }
    }
  });

  it("swaps the venue every time a pair meets", () => {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const hosts = reg
          .filter(
            (g) =>
              (g.homeTeam === teams[i] && g.awayTeam === teams[j]) ||
              (g.homeTeam === teams[j] && g.awayTeam === teams[i]),
          )
          .sort((a, b) => a.week - b.week)
          .map((g) => g.homeTeam);
        for (let k = 1; k < hosts.length; k++) expect(hosts[k]).not.toBe(hosts[k - 1]);
      }
    }
  });

  it("splits home and away as evenly as the game count allows", () => {
    for (const t of teams) {
      const home = reg.filter((g) => g.homeTeam === t).length;
      const away = reg.filter((g) => g.awayTeam === t).length;
      expect(Math.abs(home - away), t).toBeLessThanOrEqual(1);
    }
  });
});

describe("playoff field", () => {
  it("is a final for four teams and the top four for six or eight", () => {
    expect(playoffFieldSize(4)).toBe(2);
    expect(playoffFieldSize(6)).toBe(4);
    expect(playoffFieldSize(8)).toBe(4);
    expect(humansOnlyRounds(4)).toEqual(["SB"]);
    expect(humansOnlyRounds(6)).toEqual(["CONF", "SB"]);
  });
});

describe("reveal blocks", () => {
  it("returns the same object for the same block, so it is safe as a store selector", async () => {
    // `App` subscribes with `useStore(currentBlock)`: a fresh object per call
    // re-renders forever. The blocks became per-shape rather than constant
    // when season length stopped being fixed, which briefly did exactly that.
    const { currentBlock } = await import("./revealBlocks.ts");
    const base = { config: { leagueFormat: "humansOnly" }, teams: { A: {}, B: {}, C: {}, D: {} }, games: [] };
    const pre = { ...base, stage: "preseason" } as never;
    const reg = { ...base, stage: "regularSeason" } as never;
    expect(currentBlock(pre)).toBe(currentBlock(pre));
    expect(currentBlock(reg)).toBe(currentBlock(reg));
    expect(currentBlock(reg)!.lastWeek).toBe(9); // 4 teams: 18 weeks, deadline after 9
  });
});
