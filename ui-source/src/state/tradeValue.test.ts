import { describe, expect, it } from "vitest";

import type { LeagueState, Player, Position } from "@/domain";
import { pickTradeValue, tradeAssetValue } from "@/sim/MockSimulationService";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed";

/**
 * Playthrough: a 92 defensive tackle (25, $10M x4) was priced only a little
 * above a 78 corner (27, $7M x3). Trade value follows the market: elite
 * players at every position are premium assets, youth and cheap control add
 * value, and the interior line is discounted only mildly.
 */
function withPlayer(s: LeagueState, id: string, position: Position, overall: number, age: number, pay: number, years: number): void {
  const base = Object.values(s.players).find((p) => p.position === position)!;
  s.players[id] = {
    ...base,
    id,
    position,
    overall,
    age,
    nfl_team: "DET",
    contract: { ...base.contract, years_remaining: years, cap_hit_by_year: Array(years).fill(pay) },
  } as Player;
}
const value = (s: LeagueState, id: string) => tradeAssetValue(s, { kind: "player", playerId: id });

describe("trade value", () => {
  const s = createLeague(31, { ...DEFAULT_CONFIG });

  it("an elite young DT is worth far more than a good corner", () => {
    withPlayer(s, "carter", "DT", 92, 25, 10, 4);
    withPlayer(s, "mccreary", "CB", 78, 27, 7, 3);
    expect(value(s, "carter")).toBeGreaterThan(1.8 * value(s, "mccreary"));
    // and about a first-round pick or more
    expect(value(s, "carter")).toBeGreaterThan(pickTradeValue(1));
  });

  it("every 90+ outranks every 75-85 starter at the premium positions", () => {
    for (const pos of ["DT", "ILB", "S", "OG"] as Position[]) withPlayer(s, `elite_${pos}`, pos, 91, 26, 15, 3);
    for (const pos of ["CB", "WR", "EDGE", "OT", "ILB"] as Position[]) withPlayer(s, `good_${pos}`, pos, 82, 26, 12, 3);
    const elite = Math.min(...["DT", "ILB", "S", "OG"].map((p) => value(s, `elite_${p}`)));
    const good = Math.max(...["CB", "WR", "EDGE", "OT", "ILB"].map((p) => value(s, `good_${p}`)));
    expect(elite).toBeGreaterThan(good);
  });

  it("age and control move the price the right way", () => {
    withPlayer(s, "young", "EDGE", 85, 24, 8, 4);
    withPlayer(s, "old", "EDGE", 85, 32, 8, 4);
    withPlayer(s, "rental", "EDGE", 85, 24, 8, 1);
    withPlayer(s, "pricey", "EDGE", 85, 24, 40, 4);
    expect(value(s, "young")).toBeGreaterThan(value(s, "old") * 1.6);
    expect(value(s, "young")).toBeGreaterThan(value(s, "rental"));
    expect(value(s, "young")).toBeGreaterThan(value(s, "pricey"));
  });
});
