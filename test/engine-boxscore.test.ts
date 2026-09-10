import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { clock } from "../src/engine/boxscore.js";
import { formatBoxScore } from "../src/engine/report.js";
import { boxScoreFor, playWeek, startSeason } from "../src/engine/season.js";

/**
 * Phase A1: box score extraction for the game-detail UI. `boxScoreFor` re-sims a
 * scheduled game by its slate index, so it reproduces exactly what the season
 * loop played — checked here against `playWeek`'s final score.
 */

describe("clock", () => {
  it("formats seconds as mm:ss", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65)).toBe("1:05");
    expect(clock(1830)).toBe("30:30");
  });
});

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("boxScoreFor", () => {
  const p0 = startSeason(4, { year: 2026 });
  const week1 = playWeek(p0).games;
  const g = week1[0]!;
  const box = boxScoreFor(p0, { home: g.home, away: g.away });

  it("matches the score the season loop produced", () => {
    expect(box.home.team).toBe(g.home);
    expect(box.away.team).toBe(g.away);
    expect(box.home.points).toBe(g.homeScore);
    expect(box.away.points).toBe(g.awayScore);
    expect(box.week).toBe(1);
  });

  it("is deterministic", () => {
    const again = boxScoreFor(p0, { home: g.home, away: g.away });
    expect(again).toEqual(box);
  });

  it("has internally coherent team lines", () => {
    for (const t of [box.home, box.away]) {
      expect(t.totalYards).toBe(t.passYards + t.rushYards);
      expect(t.completions).toBeLessThanOrEqual(t.passAtt);
      expect(t.thirdDown[0]).toBeLessThanOrEqual(t.thirdDown[1]);
      expect(t.fourthDown[0]).toBeLessThanOrEqual(t.fourthDown[1]);
      expect(t.redZone[0]).toBeLessThanOrEqual(t.redZone[1]);
      expect(t.fieldGoals[0]).toBeLessThanOrEqual(t.fieldGoals[1]);
      expect(Number.isInteger(t.passYards)).toBe(true);
      expect(Number.isInteger(t.rushYards)).toBe(true);
      expect(t.possessionSeconds).toBeGreaterThan(0);
    }
    // possession splits the 60-minute game (± OT), give or take rounding
    const totalTop = box.home.possessionSeconds + box.away.possessionSeconds;
    expect(totalTop).toBeGreaterThan(3000);
    expect(totalTop).toBeLessThan(5400);
    // one drive row per drive; teams tagged 0/1
    expect(box.drives.length).toBeGreaterThan(12);
    for (const d of box.drives) expect([0, 1]).toContain(d.team);
  });

  it("renders a text box score with both teams and a drive list", () => {
    const out = formatBoxScore(box);
    expect(out).toContain(g.home);
    expect(out).toContain(g.away);
    expect(out).toContain("total yards");
    expect(out).toContain("drives:");
    expect(out).toMatch(/possession\s+\d+:\d\d\s+\d+:\d\d/);
  });

  it("throws for a matchup not on the schedule", () => {
    expect(() => boxScoreFor(p0, { home: "BUF", away: "BUF" })).toThrow(/not on the schedule/);
  });
});
