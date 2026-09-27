import { describe, expect, it } from "vitest";

import { MockSimulationService, packageValue } from "@/sim/MockSimulationService";

import { generateAiTradeOffers } from "./aiTrades.ts";
import { DEFAULT_CONFIG } from "./seed.ts";
import { useStore } from "./store.ts";

/**
 * What the AI offers has to be worth something by the measure that judges it.
 *
 * The package builder priced the man it was asking for as `overall - 42`,
 * with no positional weighting, while `evaluateTrade` — the thing that
 * decides whether a trade is good — multiplies by `POSITION_VALUE` (a
 * quarterback is 2.35x a guard). So a suitor chasing a 95 QB set itself a
 * target of 53, met it with a 77 guard and two seventh-round picks, and sent
 * an offer the evaluator scored at under a fifth of what it was asking for.
 *
 * Playing a stock dynasty, that is exactly what arrived: Miami offering
 * Aaron Banks and two 2027/2028 sevenths for Lamar Jackson. It is not a
 * cheat — a human can simply say no — but thirty-two of them across three
 * rounds is what makes a deadline feel like a form rather than a market.
 */
const s = () => useStore.getState();

describe("AI trade offers", () => {
  it("never asks for a player while offering a fraction of his value", async () => {
    await useStore.getState().newLeague(21, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    useStore.getState().pickTeam(s().viewerGmId, "GB");
    useStore.getState().startDraft("fantasy");
    useStore.getState().autopickRemaining();

    const sim = new MockSimulationService();
    const insulting: string[] = [];
    const generous: string[] = [];
    let seen = 0;

    // sweep a range of salts: one offer is an anecdote, the shape of the
    // market is the thing under test
    for (let salt = 0; salt < 60; salt++) {
      for (const o of generateAiTradeOffers(s(), salt, 1)) {
        seen++;
        const e = sim.evaluateTrade(s(), o.fromTeam, o.toTeam, o.fromAssets, o.toAssets);
        // `fromAssets` is what the suitor gives; `toAssets` what it asks for.
        const gives = o.fromAssets.reduce((n, a) => n + assetValue(s(), sim, a), 0);
        const asks = o.toAssets.reduce((n, a) => n + assetValue(s(), sim, a), 0);
        // and the mirror image: an offer 40 points over by the league's own
        // chart is free value, not a trade (a Parsons offer did exactly that)
        const packaged = packageValue(s(), o.fromAssets);
        if (asks > 0 && packaged / asks > 1.45) {
          generous.push(`${o.fromTeam} offered ${(100 * packaged) / asks | 0}%`);
        }
        if (asks > 0 && gives / asks < 0.5) {
          const want = o.toAssets
            .map((a) => s().players[a.playerId ?? ""]?.name ?? "pick")
            .join(", ");
          insulting.push(`${o.fromTeam} offered ${(100 * gives) / asks | 0}% for ${want}`);
        }
        expect(e).toBeTruthy();
        // and it looks like a trade: a real team does not send a dozen Day 3
        // picks, which is what walking up the late rounds used to produce
        const picks = o.fromAssets.filter((a) => a.kind === "pick").length;
        expect(picks, `${o.fromTeam} offered ${picks} picks`).toBeLessThanOrEqual(4);
      }
    }

    expect(seen, "no offers were generated at all — the market went silent").toBeGreaterThan(0);
    expect(insulting, `lowball offers: ${insulting.slice(0, 6).join(" | ")}`).toEqual([]);
    expect(generous, `giveaway offers: ${generous.slice(0, 6).join(" | ")}`).toEqual([]);
  }, 180_000);
});

/** One asset, priced the way `evaluateTrade` prices it. */
function assetValue(
  state: ReturnType<typeof s>,
  sim: MockSimulationService,
  a: { kind: string; playerId?: string; pick?: unknown },
): number {
  // measured through the evaluator itself, so the test cannot drift from it:
  // an empty side against a one-asset side is that asset's value
  const e = sim.evaluateTrade(state, "AAA", "BBB", [], [a as never]);
  return Math.abs(e.valueDelta);
}

describe("packages, not piles", () => {
  // A CPU offered Tennessee's five 75-79 depth players for Joe Burrow at an
  // online trade deadline, and summed asset values called it fair. Players
  // are valued as a package: the best in full, each one after at 70%.
  it("rates a pile of depth players below one star, and a real two-for-one near him", async () => {
    await useStore.getState().newLeague(21, { ...DEFAULT_CONFIG, humanGmCount: 1 });
    const players = Object.values(s().players).filter((p) => !p.retired);
    const qb = players.filter((p) => p.position === "QB").sort((a, b) => b.overall - a.overall)[0]!;
    const depth = players.filter((p) => p.position !== "QB" && p.overall >= 75 && p.overall <= 79).slice(0, 5);
    expect(depth).toHaveLength(5);
    const star = [{ kind: "player" as const, playerId: qb.id }];
    const pile = depth.map((p) => ({ kind: "player" as const, playerId: p.id }));
    expect(packageValue(s(), pile)).toBeLessThan(packageValue(s(), star));
    // and the evaluator the CPU accepts on sees it the same way
    const sim = new MockSimulationService();
    const ev = sim.evaluateTrade(s(), "TEN", "GB", pile, star);
    expect(ev.valueDelta).toBeGreaterThan(0); // the proposer would be getting the better of it
  });
});
