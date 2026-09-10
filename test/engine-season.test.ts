import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { roundRobinSchedule, rosterStrength, simulateSeason } from "../src/engine/season.js";
import { teamList } from "../src/engine/roster.js";

/**
 * Phase A1 regression guard: the headless season loop must produce a coherent,
 * deterministic standings table with the right shape, and better rosters must
 * trend toward more wins. The real NFL schedule is Phase A1 proper.
 */

describe("roundRobinSchedule (pool-independent)", () => {
  it("gives every team the requested number of distinct opponents, once each", () => {
    const teams = ["A", "B", "C", "D", "E", "F"];
    const rounds = roundRobinSchedule(teams, 5);
    expect(rounds).toHaveLength(5);

    const played = new Map<string, string[]>(teams.map((t) => [t, []]));
    for (const round of rounds) {
      expect(round).toHaveLength(3); // 6 teams → 3 games per round
      for (const [h, a] of round) {
        played.get(h)!.push(a);
        played.get(a)!.push(h);
      }
    }
    for (const t of teams) {
      const opps = played.get(t)!;
      expect(opps).toHaveLength(5);
      expect(new Set(opps).size).toBe(5); // all distinct
    }
  });

  it("keeps home/away close to even", () => {
    const teams = Array.from({ length: 8 }, (_, i) => `T${i}`);
    const homeCount = new Map<string, number>(teams.map((t) => [t, 0]));
    for (const round of roundRobinSchedule(teams, 7)) {
      for (const [h] of round) homeCount.set(h, homeCount.get(h)! + 1);
    }
    for (const t of teams) {
      const h = homeCount.get(t)!;
      expect(h).toBeGreaterThanOrEqual(2);
      expect(h).toBeLessThanOrEqual(5); // 7 games → 3/4 split ± a bit
    }
  });

  it("odd team counts drop a bye, not a real game", () => {
    const rounds = roundRobinSchedule(["A", "B", "C"], 3);
    for (const round of rounds) {
      expect(round).toHaveLength(1);
      for (const [h, a] of round) {
        expect(h).not.toContain("BYE");
        expect(a).not.toContain("BYE");
      }
    }
  });
});

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("simulateSeason (needs the generated pool)", () => {
  const teams = teamList();
  const season = simulateSeason(7);
  const teamGames = teams.length * 17;

  it(`schedules ${teamGames / 2} games, 17 per team`, () => {
    expect(season.games).toHaveLength(teamGames / 2);
    for (const s of season.standings) expect(s.games).toBe(17);
    expect(season.standings).toHaveLength(teams.length);
  });

  it("standings are internally consistent (ΣW = ΣL, ties paired, PF = PA leaguewide)", () => {
    let w = 0;
    let l = 0;
    let t = 0;
    let pf = 0;
    let pa = 0;
    for (const s of season.standings) {
      w += s.wins;
      l += s.losses;
      t += s.ties;
      pf += s.pointsFor;
      pa += s.pointsAgainst;
      expect(s.wins + s.losses + s.ties).toBe(17);
      expect(s.pointDiff).toBe(s.pointsFor - s.pointsAgainst);
      expect(s.winPct).toBeCloseTo((s.wins + 0.5 * s.ties) / 17, 10);
    }
    expect(w).toBe(l);
    expect(t % 2).toBe(0);
    expect(pf).toBe(pa);
  });

  it("is sorted best → worst (winPct, then point differential)", () => {
    for (let i = 1; i < season.standings.length; i += 1) {
      const prev = season.standings[i - 1]!;
      const cur = season.standings[i]!;
      expect(prev.winPct).toBeGreaterThanOrEqual(cur.winPct - 1e-9);
      if (Math.abs(prev.winPct - cur.winPct) < 1e-9) {
        expect(prev.pointDiff).toBeGreaterThanOrEqual(cur.pointDiff);
      }
    }
  });

  it("scores in a plausible band (~19 pts/team-game, the engine's known ~−11% vs 22.6)", () => {
    const perTeamGame =
      season.standings.reduce((sum, s) => sum + s.pointsFor, 0) / (teams.length * 17);
    expect(perTeamGame).toBeGreaterThan(16);
    expect(perTeamGame).toBeLessThan(26);
  });

  it("better rosters win more (Pearson winPct vs summed overall > 0.1)", () => {
    const xs = season.standings.map((s) => s.winPct);
    const ys = season.standings.map((s) => rosterStrength(s.team));
    const mean = (a: number[]) => a.reduce((p, q) => p + q, 0) / a.length;
    const mx = mean(xs);
    const my = mean(ys);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const dx = xs[i]! - mx;
      const dy = ys[i]! - my;
      sxy += dx * dy;
      sxx += dx * dx;
      syy += dy * dy;
    }
    const r = sxy / Math.sqrt(sxx * syy);
    expect(r).toBeGreaterThan(0.1); // seed 7 ≈ 0.21; other seeds 0.35–0.51
  });

  it("is deterministic in the seed", () => {
    const a = simulateSeason(123, { gamesPerTeam: 3 });
    const b = simulateSeason(123, { gamesPerTeam: 3 });
    expect(a.standings).toEqual(b.standings);
    expect(a.games).toEqual(b.games);
  });

  it("accepts an explicit schedule", () => {
    const [x, y, z] = teams;
    const r = simulateSeason(1, {
      teams: [x!, y!, z!],
      schedule: [
        [x!, y!],
        [y!, z!],
        [z!, x!],
      ],
    });
    expect(r.games).toHaveLength(3);
    for (const s of r.standings) expect(s.games).toBe(2);
  });
});
