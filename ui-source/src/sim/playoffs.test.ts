import { beforeAll, describe, expect, it } from "vitest";

import { TEAMS } from "@/data/teams";
import type { LeagueState } from "@/domain";
import { ROUND_ORDER } from "@/domain";

import { createLeague, DEFAULT_CONFIG } from "../state/seed.ts";
import { HybridSimulationService } from "./HybridSimulationService.ts";

/**
 * seedBracket / simulatePlayoffRound against the real running adapter
 * (`npm run server` in nfl-franchise-sim, http://localhost:8787) — the
 * engine's own standings/playoffs logic already has its own test suite
 * (test/engine-{standings,playoffs}.test.ts); this covers the adapter's
 * /playoffs/seed + /playoffs/round routes and this UI's mapping onto
 * BracketState, end to end through a full postseason.
 *
 * Network-gated: skips (not fails) if the adapter isn't reachable, same
 * spirit as the engine's pool-gated tests.
 */

let adapterUp = false;
beforeAll(async () => {
  try {
    const res = await fetch("http://localhost:8787/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    adapterUp = res.ok;
  } catch {
    adapterUp = false;
  }
});

function fixtureWithFullSeason(seed: number): LeagueState {
  const s = createLeague(seed, DEFAULT_CONFIG);
  // a plausible, deterministic full REG season without needing real game sim
  let i = 0;
  for (const code of Object.keys(s.teams)) {
    const opp = TEAMS[(TEAMS.findIndex((t) => t.code === code) + 1) % TEAMS.length]!.code;
    for (let w = 0; w < 3; w++) {
      i++;
      const home = i % 2 === 0 ? code : opp;
      const away = i % 2 === 0 ? opp : code;
      const homeScore = 14 + (i % 21);
      const awayScore = 10 + ((i * 7) % 24);
      s.games.push({
        id: `g_${i}`,
        week: w + 1,
        phase: "REG",
        homeTeam: home,
        awayTeam: away,
        played: true,
        homeScore,
        awayScore: homeScore === awayScore ? awayScore + 1 : awayScore,
      });
    }
  }
  return s;
}

describe("HybridSimulationService playoffs (network-gated)", () => {
  it("seeds a full 7-per-conference bracket from REG games", async () => {
    if (!adapterUp) return;
    const sim = new HybridSimulationService();
    const s = fixtureWithFullSeason(1);
    const bracket = await sim.seedBracket(s);
    expect(bracket.seeds.AFC).toHaveLength(7);
    expect(bracket.seeds.NFC).toHaveLength(7);
    expect(new Set(bracket.seeds.AFC)).not.toEqual(new Set(bracket.seeds.NFC)); // no overlap
    expect(bracket.currentRound).toBe("WC");
    // 1-seed bye + 3 real pairings, per conference
    const wc = bracket.matchups.filter((m) => m.round === "WC");
    expect(wc).toHaveLength(8);
    const bye = wc.find((m) => m.highSeed?.seed === 1 && m.lowSeed === null);
    expect(bye?.winner).toBe(bracket.seeds.AFC[0]!);
  });

  it("plays a full postseason to a champion, round by round, with consistent pairings", async () => {
    if (!adapterUp) return;
    const sim = new HybridSimulationService();
    const s = fixtureWithFullSeason(2);
    s.bracket = await sim.seedBracket(s);

    for (const round of ROUND_ORDER) {
      const before = s.bracket!;
      const played = before.matchups.filter((m) => m.round === round);
      expect(played.length).toBeGreaterThan(0);

      s.bracket = await sim.simulatePlayoffRound(s, round);
      const now = s.bracket;

      // every matchup in `round` is now decided
      const decided = now.matchups.filter((m) => m.round === round);
      for (const m of decided) {
        if (m.lowSeed === null) continue; // the WC bye — pre-decided
        expect(m.winner).not.toBeNull();
        expect([m.highSeed!.code, m.lowSeed!.code]).toContain(m.winner);
      }

      if (round === "SB") {
        expect(now.champion).not.toBeNull();
        expect(["AFC", "NFC"].some((c) => now.seeds[c as "AFC" | "NFC"].includes(now.champion!))).toBe(true);
      } else {
        expect(now.champion).toBeNull();
        expect(now.currentRound).toBe(ROUND_ORDER[ROUND_ORDER.indexOf(round) + 1]);
        // the next round's placeholder matchups are seeded from this round's winners
        const nextRound = ROUND_ORDER[ROUND_ORDER.indexOf(round) + 1]!;
        const nextMatchups = now.matchups.filter((m) => m.round === nextRound);
        expect(nextMatchups.length).toBeGreaterThan(0);
        const decidedCodes = new Set(decided.map((m) => m.winner));
        for (const nm of nextMatchups) {
          expect(decidedCodes.has(nm.highSeed!.code)).toBe(true);
          if (nm.lowSeed) expect(decidedCodes.has(nm.lowSeed.code)).toBe(true);
        }
      }
    }
  });

  it("is deterministic for the same season/seed", async () => {
    if (!adapterUp) return;
    const sim = new HybridSimulationService();
    const runOnce = async () => {
      const s = fixtureWithFullSeason(3);
      s.bracket = await sim.seedBracket(s);
      for (const round of ROUND_ORDER) s.bracket = await sim.simulatePlayoffRound(s, round);
      return s.bracket!.champion;
    };
    const [a, b] = await Promise.all([runOnce(), runOnce()]);
    expect(a).toBe(b);
  });
});
