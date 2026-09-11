import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, createLeague } from "../state/seed.ts";
import { MockSimulationService } from "./MockSimulationService.ts";
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

    const forNeed = sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(offeredQb.id)], []);
    const forNoNeed = sim.evaluateTrade(s, fromTeam, toTeam, [playerAsset(offeredWr.id)], []);
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
});
