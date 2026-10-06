import { describe, expect, it } from "vitest";

import { identityGroups } from "./draftIdentity";
import { layoutLabels } from "./labelLayout";
import { applyPick, beginDraft, planAutopicks } from "./rules";
import { createLeague, recomputeTeamRatings } from "./seed";

describe("labels on the draft summary's map", () => {
  it("a crowded row of dots gets labels that do not sit on each other", () => {
    // eight dots four pixels apart: far tighter than a real draft produces (the 32-team test below), a stress
    const dots = Array.from({ length: 8 }, (_, i) => ({ id: `T${i}`, x: 100 + i * 4, y: 100 + (i % 3), r: 5.5, w: 19, h: 9 }));
    const spots = layoutLabels(dots);
    expect([...spots.values()].filter((s) => s.overlaps > 0).length).toBeLessThanOrEqual(4);
    // an isolated dot keeps its label above
    const lone = layoutLabels([{ id: "A", x: 50, y: 50, r: 5.5, w: 19, h: 9 }]).get("A")!;
    expect(lone.overlaps).toBe(0);
    expect(lone.anchor).toBe("middle");
    expect(lone.y).toBeLessThan(50);
  });

  it("after a real fantasy draft, the 32 teams' labels are clear (nearly) everywhere", () => {
    const s = createLeague(77);
    s.stage = "fantasyDraft";
    beginDraft(s, "fantasy");
    for (const id of planAutopicks(s)) applyPick(s, id);
    recomputeTeamRatings(s);
    const all = identityGroups(s).flatMap((g) => g.teams);
    expect(all.length).toBe(32);
    const xs = all.map((t) => t.offense);
    const ys = all.map((t) => t.defense);
    const x0 = Math.min(...xs) - 2, x1 = Math.max(...xs) + 2, y0 = Math.min(...ys) - 2, y1 = Math.max(...ys) + 2;
    // the component's own geometry: 560x300, margins 36/10/10/26
    const px = (v: number) => 36 + ((v - x0) / (x1 - x0 || 1)) * (560 - 36 - 10);
    const py = (v: number) => 300 - 26 - ((v - y0) / (y1 - y0 || 1)) * (300 - 26 - 10);
    // teams sharing a rating pair are fanned out sideways, as the component does
    const seen = new Map<string, number>();
    const counts = new Map<string, number>();
    for (const t of all) counts.set(`${t.offense}|${t.defense}`, (counts.get(`${t.offense}|${t.defense}`) ?? 0) + 1);
    const dots = all.map((t) => {
      const key = `${t.offense}|${t.defense}`;
      const k = seen.get(key) ?? 0;
      seen.set(key, k + 1);
      return { id: t.code, x: px(t.offense) + (k - (counts.get(key)! - 1) / 2) * 13, y: py(t.defense), r: 5.5, w: 19, h: 9 };
    });
    const spots = layoutLabels(dots);
    const bad = [...spots.values()].filter((v) => v.overlaps > 0).length;
    console.log("labels with an overlap:", bad, "of", spots.size);
    expect(bad).toBeLessThanOrEqual(3);
  }, 180000);
});
