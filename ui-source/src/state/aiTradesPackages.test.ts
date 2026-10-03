import { describe, expect, it } from "vitest";

import { generateAiTradeOffers } from "./aiTrades.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * "Numerous low-overall players for a star": the AI used to build a package
 * out of up to three 62s for a 90, and send it again and again. A package with
 * a player in it now needs a centrepiece (a player near the star, or a first or
 * second-round pick), and never more than two players.
 */
describe("what the AI offers for a star", () => {
  it("never sends a pile of lesser players for him", () => {
    let offers = 0;
    for (const seed of [51, 52, 53]) {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
      fillRosterGaps(s);
      s.gms[0]!.isHuman = true;
      s.gms[0]!.teamCode = "GB";
      for (let salt = 0; salt < 250; salt++) {
        for (const o of generateAiTradeOffers(s, salt, 1)) {
          offers++;
          const ask = o.toAssets.flatMap((a) => (a.kind === "player" && a.playerId ? [s.players[a.playerId]!.overall] : []))[0] ?? 0;
          const given = o.fromAssets.flatMap((a) => (a.kind === "player" && a.playerId ? [s.players[a.playerId]!.overall] : []));
          const capital = o.fromAssets.some((a) => a.kind === "pick" && !!a.pick && a.pick.round <= 2);
          const where = `${o.fromTeam} for a ${ask} (gives ${given.join(",")}${capital ? " + a top pick" : ""})`;
          expect(given.length, where).toBeLessThanOrEqual(2);
          if (given.length >= 1 && !capital) expect(Math.max(...given), where).toBeGreaterThanOrEqual(ask - 14);
          if (given.length >= 2 && !capital) expect(Math.max(...given), where).toBeGreaterThanOrEqual(ask - 10);
        }
      }
    }
    expect(offers, "the AI should still make offers").toBeGreaterThan(20);
  });
});
