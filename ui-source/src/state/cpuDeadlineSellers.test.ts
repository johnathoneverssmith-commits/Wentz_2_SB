import { describe, expect, it } from "vitest";

import { TEAMS_BY_CODE } from "@/data/teams";

import { cpuToCpuOffer } from "./aiTrades.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "./seed.ts";

/**
 * What a CPU seller sells at the deadline. Any team a game under .500 used to
 * hand its franchise quarterback to a division rival for a stack of firsts.
 */
describe("a CPU seller at the deadline", () => {
  it("sells veterans to contenders outside its division, and keeps its cornerstones", () => {
    const deals: { buyer: string; seller: string; pos: string; ovr: number; age: number }[] = [];
    for (const seed of [11, 12, 13]) {
      const s = createLeague(seed, { ...DEFAULT_CONFIG, humanGmCount: 1, fantasyDraft: false });
      fillRosterGaps(s);
      for (const t of Object.values(s.teams)) t.controlledBy = { kind: "ai" };
      // a mid-season table: half the league 6-3, a quarter 2-7, the rest 4-5
      Object.keys(s.teams).forEach((c, i) => {
        const [w, l] = i % 2 === 0 ? [6, 3] : i % 4 === 1 ? [2, 7] : [4, 5];
        s.teams[c]!.wins = w;
        s.teams[c]!.losses = l;
      });
      for (const buyer of Object.keys(s.teams)) {
        for (let salt = 0; salt < 6; salt++) {
          const o = cpuToCpuOffer(s, buyer, salt);
          if (!o) continue;
          const p = s.players[o.toAssets[0]!.playerId!]!;
          deals.push({ buyer, seller: o.toTeam, pos: p.position, ovr: p.overall, age: p.age });
          // a player sent back to make the cap work is one he replaces
          for (const a of o.fromAssets) {
            const back = a.playerId ? s.players[a.playerId] : undefined;
            if (back) expect(back.overall, `sent back ${back.name} for ${p.name}`).toBeLessThan(p.overall);
          }
        }
      }
    }
    expect(deals.length, "contenders still buy").toBeGreaterThan(0);
    for (const d of deals) {
      const [b, sl] = [TEAMS_BY_CODE[d.buyer]!, TEAMS_BY_CODE[d.seller]!];
      expect(`${b.conference}${b.division}`).not.toBe(`${sl.conference}${sl.division}`);
      expect(d.pos === "QB" && d.ovr >= 78, `sold a starting QB: ${JSON.stringify(d)}`).toBe(false);
      expect(d.age <= 26 && d.ovr >= 84, `sold a young star: ${JSON.stringify(d)}`).toBe(false);
    }
  });
});
