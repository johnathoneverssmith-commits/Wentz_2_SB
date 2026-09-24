import { describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, depthAt } from "./seed.ts";
import { fitFor, fitLabel, gradeFor, tradeUnitImpact, unitReport } from "./unitReport.ts";

describe("unitReport", () => {
  const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });

  it("grades every unit against the whole league", () => {
    const r = unitReport(s, "KC");
    expect(r.units).toHaveLength(11);
    for (const u of r.units) {
      expect(u.rank).toBeGreaterThanOrEqual(1);
      expect(u.rank).toBeLessThanOrEqual(32);
      expect(u.grade).toBe(gradeFor(u.rank, 32));
    }
    // real rosters: the units differ, so the ranks spread out
    expect(new Set(r.units.map((u) => u.rank)).size).toBeGreaterThan(3);
    const ranks = Object.keys(s.teams).map((c) => unitReport(s, c).units.find((u) => u.key === "offensiveLine")!.rank);
    expect(ranks).toContain(1);
  });

  it("follows the depth chart and names a weak link that drags the unit down", () => {
    const line = depthAt(s, "KC", "OG");
    const worst = [...Object.values(s.players)]
      .filter((p) => p.nfl_team === "KC" && p.position === "OG")
      .sort((a, b) => a.overall - b.overall)[0]!;
    // start the worst guard
    s.depthChart = { ...s.depthChart, KC: { ...s.depthChart?.KC, OG: [worst.id, ...line.map((p) => p.id).filter((id) => id !== worst.id)] } };
    const ol = unitReport(s, "KC").units.find((u) => u.key === "offensiveLine")!;
    expect(ol.starters.map((x) => x.id)).toContain(worst.id);
    if (ol.weakLink) expect(ol.weakLink.overall).toBe(Math.min(...ol.starters.map((x) => x.overall)));
    expect(ol.upgradeValue).toBeGreaterThanOrEqual(0);
  });

  it("gradeFor spans A to F", () => {
    expect(gradeFor(1, 32)).toBe("A");
    expect(gradeFor(32, 32)).toBe("F");
  });
});

describe("fitFor", () => {
  const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
  const fit = fitFor(s, "KC");

  it("a backup-calibre player is depth; a star at a weak spot is a major upgrade", () => {
    expect(fit("QB", 55).label).toBe("Depth");
    const weakest = unitReport(s, "KC").units
      .filter((u) => u.weight > 0.2)
      .sort((a, b) => a.strength - b.strength)[0]!;
    const pos = weakest.starters[0]!.position;
    expect(fit(pos, 97).gain).toBeGreaterThan(fit(pos, 80).gain);
    expect(fit(pos, 97).label).not.toBe("Depth");
  });

  it("labels are monotone in gain", () => {
    expect(fitLabel(2).label).toBe("Major upgrade");
    expect(fitLabel(0.6).label).toBe("Upgrade");
    expect(fitLabel(0.2).label).toBe("Minor upgrade");
    expect(fitLabel(0).label).toBe("Depth");
  });
});

describe("tradeUnitImpact", () => {
  it("reports the unit a trade strengthens, and nothing it leaves alone", () => {
    const s = createLeague(3, { ...DEFAULT_CONFIG, fantasyDraft: false });
    const theirBestDt = Object.values(s.players)
      .filter((p) => p.position === "DT" && p.nfl_team !== "GB" && s.teams[p.nfl_team])
      .sort((a, b) => b.overall - a.overall)[0]!;
    const myWorstStartingDt = Object.values(s.players)
      .filter((p) => p.position === "DT" && p.nfl_team === "GB")
      .sort((a, b) => b.overall - a.overall)[1]!;
    const d = tradeUnitImpact(s, "GB", [myWorstStartingDt.id], [theirBestDt.id]);
    const interior = d.find((u) => u.key === "interior");
    if (theirBestDt.overall > myWorstStartingDt.overall) {
      expect(interior!.after).toBeGreaterThan(interior!.before);
      expect(interior!.rankAfter).toBeLessThanOrEqual(interior!.rankBefore);
    }
    expect(d.every((u) => ["interior"].includes(u.key))).toBe(true);
    expect(tradeUnitImpact(s, "GB", [], [])).toEqual([]);
  });
});
