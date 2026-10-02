import { expect, it } from "vitest";

import { generateAiTradeOffers } from "./aiTrades.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * Every roster carries a backup quarterback, so "someone behind him" let the
 * CPU ask a GM for his 93 starter — a 58 behind him — at every deadline.
 */
it("never asks for a starter with nobody near him behind", () => {
  const s = createLeague(51, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
  fillRosterGaps(s);
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = "GB";
  const qbs = Object.values(s.players)
    .filter((p) => p.nfl_team === "GB" && !p.free_agent && !p.retired && p.position === "QB")
    .sort((a, b) => b.overall - a.overall);
  qbs[0]!.overall = 93;
  for (const q of qbs.slice(1)) q.overall = 58;
  const asked = new Set<string>();
  for (let salt = 0; salt < 300; salt++) {
    for (const o of generateAiTradeOffers(s, salt, 1)) {
      for (const a of o.toAssets) if (a.kind === "player" && a.playerId) asked.add(a.playerId);
    }
  }
  expect(asked.size).toBeGreaterThan(0);
  expect(asked.has(qbs[0]!.id)).toBe(false);
});
