import { describe, expect, it } from "vitest";

import type { Player } from "../src/schema/player.js";
import { loadPool, Roster, roster, teamList } from "../src/engine/roster.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * Talent scale (`Game.talent`) — the franchise game's "talent impact".
 *
 * At 1 it must be the validated engine exactly; above 1 a better roster has
 * to win more often. Magnitudes live in `ui-source/src/state/talentImpact.ts`.
 */
describe("talent scale", () => {
  it("is the validated engine, byte for byte, at 1", () => {
    const [h, a] = [teamList()[3]!, teamList()[17]!];
    for (let seed = 1; seed <= 5; seed++) {
      const plain = simulateGame(seed, h, a, { injuries: true });
      const scaled = simulateGame(seed, h, a, { injuries: true, talentScale: 1 });
      expect(scaled.score).toEqual(plain.score);
      expect(scaled.teams[0].s).toEqual(plain.teams[0].s);
    }
  });

  it("makes a stronger roster win by more when turned up", () => {
    const base = teamList()[3]!;
    // the same team with its starters swapped for the pool's best at each spot
    const all: Player[] = [...loadPool().values()].flat();
    const players = [...loadPool().get(base)!];
    const order: Record<string, string[]> = {};
    for (const pos of ["QB", "RB", "WR", "OT", "OG", "C", "EDGE", "DT", "CB", "S"]) {
      const best = all
        .filter((p) => p.position === pos)
        .sort((x, y) => (y.overall ?? 0) - (x.overall ?? 0))
        .slice(0, 3)
        .map((p) => ({ ...p, id: `${p.id}__t` }));
      players.push(...best);
      order[pos] = best.map((p) => p.id);
    }
    const strong = new Roster(base, players, order);
    const opp = teamList()[17]!;
    // margin rather than wins: an all-star lineup already wins nearly every
    // game at the validated scale, so only *how much* it wins by can grow
    const marginAt = (talentScale: number): number => {
      let m = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const g = simulateGame(seed * 7, base, opp, { homeRoster: strong, awayRoster: roster(opp), talentScale });
        m += g.score[0] - g.score[1];
      }
      return m / 60;
    };
    expect(marginAt(2)).toBeGreaterThan(marginAt(1) + 3);
  }, 180_000);
});
