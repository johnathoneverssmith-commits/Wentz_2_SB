import { describe, expect, it } from "vitest";

import { MockSimulationService, franchiseQbPremium, isFranchiseQb, packageValue } from "@/sim/MockSimulationService";

import { createLeague, DEFAULT_CONFIG } from "./seed";
import { picksOwnedBy, ensureDraftPicks } from "./draftPicks";

const league = () => {
  const s = createLeague(5, { ...DEFAULT_CONFIG, fantasyDraft: false });
  ensureDraftPicks(s, s.season + 1);
  return s;
};
const bestQb = (s: ReturnType<typeof league>) =>
  Object.values(s.players).filter((p) => p.position === "QB" && p.nfl_team !== "FA").sort((a, b) => b.overall - a.overall)[0]!;

describe("franchise quarterbacks", () => {
  it("the league's best QB is one, and costs far more than his rating alone says", () => {
    const s = league();
    const q = bestQb(s);
    expect(isFranchiseQb(s, q)).toBe(true);
    expect(franchiseQbPremium(s, q)).toBeGreaterThan(4);
    // a 76 starter is just a starter
    const mid = Object.values(s.players).find((p) => p.position === "QB" && p.overall <= 78 && p.overall >= 70 && p.nfl_team !== "FA")!;
    expect(franchiseQbPremium(s, mid)).toBe(1);
  });

  it("two firsts, two seconds and a third no longer buy Joe Burrow, and the CPU won't sell him for picks at all", () => {
    const s = league();
    const q = bestQb(s);
    const seller = q.nfl_team;
    const buyer = Object.keys(s.teams).find((c) => c !== seller)!;
    const picks = picksOwnedBy(s, buyer, s.season + 1);
    const offer = [1, 1, 2, 2, 3].map((r, i) => picks.filter((p) => p.round === r)[i % 1 === 0 ? 0 : 0]!);
    const assets = [
      ...picks.filter((p) => p.round <= 3).map((pick) => ({ kind: "pick" as const, pick })),
    ];
    expect(packageValue(s, [{ kind: "player", playerId: q.id }])).toBeGreaterThan(packageValue(s, assets) * 2);
    void offer;
    const ev = new MockSimulationService().evaluateTrade(s, buyer, seller, assets, [{ kind: "player", playerId: q.id }]);
    expect(ev.acceptLikelihood).toBe(0);
    expect(ev.refusal).toMatch(/franchise quarterback/);
  });

  it("two franchise quarterbacks can be swapped", () => {
    const s = league();
    const qbs = Object.values(s.players)
      .filter((p) => p.position === "QB" && p.nfl_team !== "FA" && isFranchiseQb(s, p))
      .sort((a, b) => b.overall - a.overall);
    expect(qbs.length).toBeGreaterThan(2);
    const [a, b] = [qbs[0]!, qbs[1]!];
    const ev = new MockSimulationService().evaluateTrade(s, b.nfl_team, a.nfl_team, [{ kind: "player", playerId: b.id }], [{ kind: "player", playerId: a.id }]);
    expect(ev.refusal).toBeUndefined();
  });
});
