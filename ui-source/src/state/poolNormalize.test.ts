import { describe, expect, it } from "vitest";

import type { Player } from "@/domain";

import { normalizePool } from "./seed.ts";

/**
 * The engine's `/pool` hands back 1,987 players who each carry a real team
 * code *and* `free_agent: true` *and* no contract. That shape breaks the
 * franchise layer twice over: the same player counts as rostered and as
 * market supply, and nobody costs anything — with the adapter running, 637
 * rostered players were free and every team sat $190M under the cap.
 */
function poolPlayer(over: Partial<Player> = {}): Player {
  return {
    id: "p_1",
    name: "A. Player",
    position: "WR",
    age: 26,
    nfl_team: "CLE",
    years_pro: 4,
    overall: 82,
    attributes: { speed: 85, strength: 70, awareness: 78 },
    scheme_tags: [],
    dev_age_threshold: 25,
    decline_age_threshold: 30,
    injury_history: [],
    contract: null,
    free_agent: true,
    injury_status: null,
    retired: false,
    retirement_status: "active",
    season_stats: { gamesPlayed: 0 },
    ...over,
  } as Player;
}

describe("normalizePool", () => {
  it("clears every team in a fantasy league — the draft is what assigns them", () => {
    const pool = [poolPlayer(), poolPlayer({ id: "p_2", nfl_team: "KC" })];
    normalizePool(pool, true, 1);
    for (const p of pool) {
      expect(p.free_agent).toBe(true);
      expect(p.nfl_team).toBe("FA");
      expect(p.contract).toBeNull();
    }
  });

  it("keeps real teams and pays market rate when there's no fantasy draft", () => {
    const pool = [poolPlayer()];
    normalizePool(pool, false, 1);
    const p = pool[0]!;
    expect(p.free_agent).toBe(false);
    expect(p.nfl_team).toBe("CLE");
    expect(p.contract).not.toBeNull();
    expect(p.contract!.cap_hit_by_year[0]).toBeGreaterThan(1);
    expect(p.contract!.team_id).toBe("CLE");
  });

  it("staggers terms so they don't all expire in the same offseason", () => {
    const pool = Array.from({ length: 60 }, (_, i) => poolPlayer({ id: `p_${i}` }));
    normalizePool(pool, false, 9);
    const terms = new Set(pool.map((p) => p.contract!.years_remaining));
    expect(terms.size).toBeGreaterThan(1);
  });

  it("leaves a genuinely unowned player on the market", () => {
    const pool = [poolPlayer({ nfl_team: "FA" })];
    normalizePool(pool, false, 1);
    expect(pool[0]!.free_agent).toBe(true);
    expect(pool[0]!.contract).toBeNull();
  });

  it("never leaves a player both rostered and available", () => {
    const pool = Array.from({ length: 40 }, (_, i) =>
      poolPlayer({ id: `p_${i}`, nfl_team: i % 3 === 0 ? "FA" : "KC" }),
    );
    normalizePool(pool, false, 4);
    for (const p of pool) expect(p.free_agent).toBe(p.nfl_team === "FA");
  });
});
