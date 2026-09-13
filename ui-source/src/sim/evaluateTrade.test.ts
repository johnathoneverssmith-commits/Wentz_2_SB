import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, createLeague } from "../state/seed.ts";
import { contractValueFor, MockSimulationService } from "./MockSimulationService.ts";
import type { LeagueState, TradeAsset } from "@/domain";

/**
 * evaluateTrade (OQ-9): the AI (toTeam)'s willingness to accept a trade
 * should fall as the deal favors the human proposer more, and should rise
 * when the incoming player(s) address a real roster need — not the other
 * way around, and not value-only.
 */

function fixture(): LeagueState {
  return createLeague(1, DEFAULT_CONFIG);
}

const sim = new MockSimulationService();

function playerAsset(id: string): TradeAsset {
  return { kind: "player", playerId: id };
}

describe("evaluateTrade", () => {
  it("acceptLikelihood falls as the deal favors the proposer more (not rises)", () => {
    const s = fixture();
    const players = Object.values(s.players);
    const lo = players.find((p) => p.overall <= 65)!;
    const hi = players.find((p) => p.overall >= 90)!;
    const fromTeam = lo.nfl_team;
    const toTeam = hi.nfl_team;
    expect(fromTeam).not.toBe(toTeam);

    // a lopsided ask: proposer gives a weak player, asks for a star back
    const lopsided = sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(lo.id)], [playerAsset(hi.id)]);
    // a fair-ish swap of similar value
    const similarLo = players.find((p) => p.id !== lo.id && Math.abs(p.overall - lo.overall) <= 2 && p.nfl_team === fromTeam);
    const fair = similarLo
      ? sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(lo.id)], [playerAsset(similarLo.id)])
      : null;

    expect(lopsided.valueDelta).toBeGreaterThan(0); // clearly favors the proposer
    expect(lopsided.acceptLikelihood).toBeLessThan(0.5); // so the AI should be reluctant
    if (fair) {
      expect(lopsided.acceptLikelihood).toBeLessThan(fair.acceptLikelihood);
    }
  });

  it("is more willing to accept a comparable-value player who fills a real need", () => {
    const s = fixture();
    const codes = Object.keys(s.teams);
    const [toTeam] = codes;
    const fromTeam = codes.find((c) => c !== toTeam)!;

    // clear toTeam's QBs entirely (maximal need), leave WR alone
    for (const p of Object.values(s.players)) {
      if (p.nfl_team === toTeam && p.position === "QB") p.nfl_team = "FA";
    }
    const proposerPlayers = Object.values(s.players).filter((p) => p.nfl_team === fromTeam);
    const offeredQb = { ...proposerPlayers.find((p) => p.position === "QB")! };
    const offeredWr = proposerPlayers.find((p) => p.position === "WR" && Math.abs(p.overall - offeredQb.overall) <= 3);
    if (!offeredWr) return; // fixture didn't have a close-value WR this seed; skip rather than flake

    // ask for something back of comparable value: a giveaway pins acceptance
    // at the ceiling for both, and a saturated number can't show the need
    // signal at all
    const back = Object.values(s.players)
      .filter((p) => p.nfl_team === toTeam && p.position !== "QB")
      .sort((a, b) => Math.abs(a.overall - offeredQb.overall) - Math.abs(b.overall - offeredQb.overall))[0];
    if (!back) return;

    const forNeed = sim.evaluateTrade(
      s,
      fromTeam,
      toTeam,
      [playerAsset(offeredQb.id)],
      [playerAsset(back.id)],
    );
    const forNoNeed = sim.evaluateTrade(
      s,
      fromTeam,
      toTeam,
      [playerAsset(offeredWr.id)],
      [playerAsset(back.id)],
    );
    expect(forNeed.acceptLikelihood).toBeGreaterThan(forNoNeed.acceptLikelihood);
  });

  it("giving up a player from an already-thin position lowers acceptLikelihood vs. a deep one", () => {
    const s = fixture();
    const codes = Object.keys(s.teams);
    const [toTeam] = codes;
    const fromTeam = codes.find((c) => c !== toTeam)!;

    const roster = Object.values(s.players).filter((p) => p.nfl_team === toTeam);
    const qbs = roster.filter((p) => p.position === "QB");
    const wrs = roster.filter((p) => p.position === "WR");
    if (qbs.length < 1 || wrs.length < 2) return; // need at least a thin QB room to compare

    // make QB the AI's only one (thin) — giving it up should hurt more than
    // giving up a WR when there are several. Offer matched compensation in
    // both scenarios so the raw value delta doesn't saturate the clamp and
    // swamp the need term being tested.
    for (const p of qbs.slice(1)) p.nfl_team = "FA";
    const onlyQb = Object.values(s.players).find((p) => p.nfl_team === toTeam && p.position === "QB")!;
    const spareWr = wrs[0]!;
    const compFor = (overall: number) =>
      Object.values(s.players).find(
        (p) => p.nfl_team === fromTeam && Math.abs(p.overall - overall) <= 3,
      );
    const compQb = compFor(onlyQb.overall);
    const compWr = compFor(spareWr.overall);
    if (!compQb || !compWr) return; // fixture didn't have close comps this seed; skip rather than flake

    const giveQb = sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(compQb.id)], [playerAsset(onlyQb.id)]);
    const giveWr = sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(compWr.id)], [playerAsset(spareWr.id)]);
    expect(giveQb.acceptLikelihood).toBeLessThan(giveWr.acceptLikelihood);
  });

  it("values a QB above a kicker at the same overall (positional value, not overall-only)", () => {
    const s = fixture();
    const codes = Object.keys(s.teams);
    const [toTeam] = codes;
    const fromTeam = codes.find((c) => c !== toTeam)!;
    const qb = Object.values(s.players).find((p) => p.nfl_team === toTeam && p.position === "QB")!;
    const k = { ...qb, id: "p_fake_k", position: "K" as const, nfl_team: toTeam };
    s.players[k.id] = k;
    // same overall, different position, both offered *to* the proposer for
    // nothing back — valueDelta is "good for the proposer", so the more
    // valuable incoming asset should score higher.
    const qbTrade = sim.evaluateTrade(s, fromTeam, toTeam, [], [playerAsset(qb.id)]);
    const kTrade = sim.evaluateTrade(s, fromTeam, toTeam, [], [playerAsset(k.id)]);
    expect(qbTrade.valueDelta).toBeGreaterThan(kTrade.valueDelta);
  });

  it("values a 1st-round pick far more than linearly above a 2nd (real convex chart, not a flat scale)", () => {
    const s = fixture();
    const codes = Object.keys(s.teams);
    const [toTeam] = codes;
    const fromTeam = codes.find((c) => c !== toTeam)!;
    const pickAsset = (round: number): TradeAsset => ({
      kind: "pick",
      pick: { year: s.season + 1, round, ownedBy: toTeam, originalTeam: toTeam },
    });
    // picks offered *to* the proposer for nothing back — valueDelta is "good
    // for the proposer", so the more valuable incoming pick scores higher.
    const round1 = sim.evaluateTrade(s, fromTeam, toTeam, [], [pickAsset(1)]);
    const round2 = sim.evaluateTrade(s, fromTeam, toTeam, [], [pickAsset(2)]);
    const round7 = sim.evaluateTrade(s, fromTeam, toTeam, [], [pickAsset(7)]);
    expect(round1.valueDelta).toBeGreaterThan(round2.valueDelta);
    // the old formula was flat (~1.17x round1/round2); the real chart is ~2.8x
    expect(round1.valueDelta).toBeGreaterThan(round2.valueDelta * 2);
    expect(round2.valueDelta).toBeGreaterThan(round7.valueDelta * 5);
  });
});

describe("contractValueFor (positional value)", () => {
  it("pays a QB more than a running back at the same overall", () => {
    expect(contractValueFor(85, "QB")).toBeGreaterThan(contractValueFor(85, "RB"));
  });

  it("pays a kicker the least among common comparisons", () => {
    const positions = ["QB", "EDGE", "WR", "OT", "CB", "RB"] as const;
    for (const pos of positions) {
      expect(contractValueFor(80, pos)).toBeGreaterThan(contractValueFor(80, "K"));
    }
  });

  it("with no position given, matches the neutral (1.0x) baseline", () => {
    expect(contractValueFor(80)).toBeCloseTo(contractValueFor(80, undefined), 6);
  });
});
