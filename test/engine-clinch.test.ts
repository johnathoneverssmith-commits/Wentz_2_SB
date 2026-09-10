import { describe, expect, it } from "vitest";

import { type ClinchTag, clinchStatus, topClinchTag } from "../src/engine/clinch.js";
import { NFL_TEAMS } from "../src/engine/nfl-structure.js";
import { formatStandingsThrough } from "../src/engine/report.js";
import { nflSchedule } from "../src/engine/schedule.js";
import { type FinishedGame, computeStandings } from "../src/engine/standings.js";

/**
 * Phase A1: conservative clinch/elimination tags. The tracker's contract is
 * (1) soundness — it never tags something the real final standings contradict —
 * and (2) monotonicity — a clinch, once earned, is never taken back as more
 * results come in.
 */

const SCHED = nflSchedule({ year: 2026 });
const IDX = new Map(NFL_TEAMS.map((t, i) => [t, i]));

// decide a game deterministically by a strength function (home edge, no ties)
function decider(strength: (t: string) => number) {
  return (p: { home: string; away: string }): FinishedGame => {
    const diff = strength(p.home) + 0.3 - strength(p.away);
    const m = Math.max(1, Math.min(24, Math.round(Math.abs(diff))));
    return diff > 0
      ? { home: p.home, away: p.away, homeScore: 20 + m, awayScore: 20 }
      : { home: p.home, away: p.away, homeScore: 20, awayScore: 20 + m };
  };
}

const through = (week: number, dec: (p: { home: string; away: string }) => FinishedGame) =>
  SCHED.filter((g) => g.week <= week).map(dec);

describe("clinchStatus", () => {
  it("tags nothing before any games are played", () => {
    for (const r of clinchStatus([], SCHED)) expect(r.tags).toHaveLength(0);
  });

  it("is deterministic", () => {
    const dec = decider((t) => IDX.get(t)!);
    expect(clinchStatus(through(10, dec), SCHED)).toEqual(clinchStatus(through(10, dec), SCHED));
  });

  it("never contradicts the final standings", () => {
    const dec = decider((t) => IDX.get(t)!);
    const finished = SCHED.map(dec);
    const standings = computeStandings(finished);
    const madePlayoffs = new Set(standings.rows.filter((r) => r.madePlayoffs).map((r) => r.team));
    const wonDivision = new Set(standings.rows.filter((r) => r.wonDivision).map((r) => r.team));
    const seed1 = new Set(
      standings.rows.filter((r) => r.seed === 1).map((r) => r.team),
    );

    const clinch = clinchStatus(finished, SCHED);
    for (const c of clinch) {
      if (c.tags.includes("berth")) expect(madePlayoffs.has(c.team)).toBe(true);
      if (c.tags.includes("division")) expect(wonDivision.has(c.team)).toBe(true);
      if (c.tags.includes("bye")) expect(seed1.has(c.team)).toBe(true);
      if (c.tags.includes("eliminated")) expect(madePlayoffs.has(c.team)).toBe(false);
      expect(c.tags.includes("berth") && c.tags.includes("eliminated")).toBe(false);
    }
    // it does still resolve most of the field — the majority of playoff teams
    // are tagged "berth", and most non-playoff teams "eliminated".
    const berths = clinch.filter((c) => c.tags.includes("berth")).length;
    const elims = clinch.filter((c) => c.tags.includes("eliminated")).length;
    expect(berths).toBeGreaterThanOrEqual(10); // of 14
    expect(elims).toBeGreaterThanOrEqual(12); // of 18
  });

  it("is monotonic — a clinch is never taken back", () => {
    const dec = decider((t) => IDX.get(t)!);
    const weeks = [8, 10, 12, 14, 16, 17, 18];
    const rank: Record<ClinchTag, number> = {
      eliminated: 0,
      berth: 1,
      division: 2,
      bye: 3,
      homefield: 4,
    };
    let prev = new Map<string, Set<ClinchTag>>(NFL_TEAMS.map((t) => [t, new Set()]));
    for (const w of weeks) {
      const now = new Map(
        clinchStatus(through(w, dec), SCHED).map((c) => [c.team, new Set(c.tags)]),
      );
      for (const t of NFL_TEAMS) {
        for (const tag of prev.get(t)!) {
          // "eliminated" and the positive tags are mutually exclusive tracks;
          // once on one track a team never crosses to the other
          const kept = now.get(t)!;
          if (tag === "eliminated") {
            expect(kept.has("eliminated")).toBe(true);
          } else {
            // some positive tag of at least this strength is still present
            const best = [...kept]
              .filter((x) => x !== "eliminated")
              .reduce((m, x) => Math.max(m, rank[x]), -1);
            expect(best).toBeGreaterThanOrEqual(rank[tag]);
          }
        }
      }
      prev = now;
    }
  });

  it("a wire-to-wire team ends with home field, a winless team ends eliminated", () => {
    const best = NFL_TEAMS[7]!;
    const worst = NFL_TEAMS[24]!;
    // everyone else equal → home team wins; nobody but `best` runs the table
    const dec = decider((t) => (t === best ? 999 : t === worst ? -999 : 0));
    const full = clinchStatus(SCHED.map(dec), SCHED);

    const b = full.find((c) => c.team === best)!;
    expect(b.tags).toEqual(expect.arrayContaining(["homefield", "bye", "division", "berth"]));
    expect(topClinchTag(b)).toBe("homefield");

    const w = full.find((c) => c.team === worst)!;
    expect(w.tags).toContain("eliminated");
    expect(topClinchTag(w)).toBe("eliminated");
  });

  it("a dominant team clinches its berth before the finale", () => {
    const star = "ARI";
    const dec = decider((t) => (t === star ? 999 : IDX.get(t)!));
    // by week 16 a 16-0 team is mathematically in
    const wk16 = clinchStatus(through(16, dec), SCHED).find((c) => c.team === star)!;
    expect(wk16.tags).toContain("berth");
  });

  it("formatStandingsThrough renders the mid-season view", () => {
    const dec = decider((t) => (t === "ARI" ? 999 : IDX.get(t)!));
    const games = SCHED.map((g) => {
      const r = dec(g);
      return { week: g.week, home: g.home, away: g.away, homeScore: r.homeScore, awayScore: r.awayScore };
    });
    const out = formatStandingsThrough(games, SCHED, 16, "NFL 2026");
    expect(out).toContain("through week 16");
    expect(out).toMatch(/of 272 games played/);
    expect(out).toContain("ARI");
    // ARI is 16-0 and appears with a clinch marker (x-, z-, or z*)
    expect(out).toMatch(/(x-|z-|z\*)\s*\(\d\) ARI/);
  });
});
