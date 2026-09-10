import { describe, expect, it } from "vitest";

import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { formatPlayoffPicture } from "../src/engine/report.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { type SeasonProgress, playoffPicture } from "../src/engine/season.js";

/**
 * Phase A1: the "if the season ended today" + who's-alive view. Pool-free — a
 * SeasonProgress is plain data, so we build one from a synthetic result set.
 */

const SCHEDULE = nflSchedule({ year: 2026 });
const IDX = new Map(NFL_TEAMS.map((t, i) => [t, i]));

/** A SeasonProgress with weeks 1..throughWeek decided by a strength function. */
function progressThrough(throughWeek: number, strength: (t: string) => number): SeasonProgress {
  const results = SCHEDULE.filter((g) => g.week <= throughWeek).map((g) => {
    const diff = strength(g.home) + 0.25 - strength(g.away);
    const m = Math.max(1, Math.min(28, Math.round(Math.abs(diff))));
    return diff > 0
      ? { week: g.week, home: g.home, away: g.away, homeScore: 20 + m, awayScore: 20 }
      : { week: g.week, home: g.home, away: g.away, homeScore: 20, awayScore: 20 + m };
  });
  return {
    seed: 1,
    year: 2026,
    schedule: SCHEDULE,
    nextWeek: throughWeek + 1,
    results,
    useStaff: false,
  };
}

describe("playoffPicture", () => {
  const strong = (t: string) => IDX.get(t)!;

  it("gives 7 seeds per conference, ordered, with division/wild-card labels", () => {
    const pic = playoffPicture(progressThrough(12, strong));
    for (const conf of ["AFC", "NFC"] as const) {
      const seeds = pic[conf].seeds;
      expect(seeds.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(seeds.slice(0, 4).every((s) => s.wonDivision)).toBe(true);
      expect(seeds.slice(4).every((s) => !s.wonDivision)).toBe(true);
      for (const s of seeds) expect(NFL_TEAMS).toContain(s.team);
    }
  });

  it("in-hunt teams are outside the top 7, sorted, with non-negative games-back", () => {
    const pic = playoffPicture(progressThrough(12, strong));
    for (const conf of ["AFC", "NFC"] as const) {
      const seeded = new Set(pic[conf].seeds.map((s) => s.team));
      const hunt = pic[conf].inHunt;
      for (const h of hunt) {
        expect(seeded.has(h.team)).toBe(false);
        expect(h.gamesBack).toBeGreaterThanOrEqual(0);
      }
      for (let i = 1; i < hunt.length; i += 1) {
        expect(hunt[i]!.gamesBack).toBeGreaterThanOrEqual(hunt[i - 1]!.gamesBack - 1e-9);
      }
      // 16 teams = 7 seeds + inHunt + eliminated
      expect(7 + hunt.length + pic[conf].eliminated.length).toBe(16);
    }
  });

  it("a dominant team shows a clinch tag on its seed line late in the year", () => {
    const pic = playoffPicture(progressThrough(16, (t) => (t === "ARI" ? 999 : IDX.get(t)!)));
    const ari = pic.NFC.seeds.find((s) => s.team === "ARI")!;
    expect(ari.clinch).not.toBeNull();
  });

  it("carries the tiebreaker note onto the seed it explains", () => {
    // tight league → lots of ties → some seed gets a tiebreaker note
    const pic = playoffPicture(progressThrough(17, (t) => IDX.get(t)! % 4));
    const withNote = [...pic.AFC.seeds, ...pic.NFC.seeds].filter((s) => s.tiebreaker);
    expect(withNote.length).toBeGreaterThan(0);
    for (const s of withNote) expect(typeof s.tiebreaker).toBe("string");
  });

  it("renders a text view", () => {
    const out = formatPlayoffPicture(progressThrough(12, strong), "NFL 2026");
    expect(out).toContain("through week 12");
    expect(out).toContain("=== AFC ===");
    expect(out).toContain("div winner");
    expect(out).toMatch(/in the hunt:|eliminated:/);
  });

  it("is deterministic", () => {
    const a = playoffPicture(progressThrough(10, strong));
    const b = playoffPicture(progressThrough(10, strong));
    expect(a).toEqual(b);
  });
});
