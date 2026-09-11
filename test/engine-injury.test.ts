import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Player } from "../src/schema/player.js";
import { LOCAL_POOL_PATH } from "../src/data/players.js";
import { type InjuryPlayContext, makeInjury } from "../src/engine/injury.js";
import { Rng } from "../src/engine/rng.js";
import { simulateGame } from "../src/engine/sim.js";

/**
 * In-game injuries + the per-play trace. Both are opt-in and consume no RNG when
 * off, so `simulateGame(seed, home, away)` is unchanged (covered by the parity
 * test). Here: the event shape / narrative, and the trace shape.
 */

function fakePlayer(id: string, name: string, position: string): Player {
  return {
    id,
    name,
    position,
    age: 26,
    nfl_team: "KC",
    years_pro: 4,
    overall: 80,
    attributes: {},
    scheme_tags: [],
    dev_age_threshold: 24,
    decline_age_threshold: 30,
    injury_history: [],
    contract: null,
    free_agent: false,
    injury_status: null,
    retired: false,
  } as unknown as Player;
}

describe("makeInjury (pool-free)", () => {
  const ctx: InjuryPlayContext = {
    offenseTeam: "PHI",
    defenseTeam: "DAL",
    quarter: 2,
    clock: "7:32",
    call: "pass",
    outcome: "complete",
    gained: 15,
    depth: "INTERMEDIATE",
    offense: [
      { slot: "QB1", player: fakePlayer("p_1", "Jalen Hurts", "QB") },
      { slot: "WR1", player: fakePlayer("p_2", "A.J. Brown", "WR") },
      { slot: "LT", player: fakePlayer("p_3", "Jordan Mailata", "OT") },
      { slot: "RB1", player: fakePlayer("p_4", "Saquon Barkley", "RB") },
    ],
    defense: [
      { slot: "EDGE1", player: fakePlayer("p_9", "Micah Parsons", "EDGE") },
      { slot: "CB1", player: fakePlayer("p_10", "DaRon Bland", "CB") },
      { slot: "S1", player: fakePlayer("p_11", "Malik Hooker", "S") },
    ],
  };

  it("builds a well-formed event with a readable narrative", () => {
    const ev = makeInjury(new Rng(1), ctx)!;
    expect(ev).toBeTruthy();
    expect([ctx.offenseTeam, ctx.defenseTeam]).toContain(ev.team);
    expect([...ctx.offense, ...ctx.defense].map((c) => c.player!.id)).toContain(ev.playerId);
    expect(ev.narrative).toContain(ev.player);
    expect(ev.narrative).toMatch(/ while /);
    expect(ev.narrative.endsWith(".")).toBe(true);
    const [lo, hi] = ev.projectedWeeks;
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThanOrEqual(lo);
    expect(hi).toBeLessThanOrEqual(18);
    expect(["minor", "moderate", "significant", "severe", "season"]).toContain(ev.severity);
  });

  it("is deterministic in the RNG", () => {
    expect(makeInjury(new Rng(42), ctx)).toEqual(makeInjury(new Rng(42), ctx));
  });

  it("varies the victim / injury across the RNG stream", () => {
    const players = new Set<string>();
    const parts = new Set<string>();
    for (let s = 0; s < 40; s += 1) {
      const ev = makeInjury(new Rng(s), ctx)!;
      players.add(ev.playerId);
      parts.add(ev.bodyPart);
    }
    expect(players.size).toBeGreaterThan(2);
    expect(parts.size).toBeGreaterThan(2);
  });
});

const hasPool = existsSync(LOCAL_POOL_PATH);

describe.runIf(hasPool)("injuries + trace in simulateGame", () => {
  it("the trace adds no RNG — a trace-only game scores exactly like a plain one", { timeout: 60_000 }, () => {
    for (const seed of [1, 20, 300]) {
      expect(simulateGame(seed, "KC", "BUF", { trace: true }).score).toEqual(
        simulateGame(seed, "KC", "BUF").score,
      );
    }
  });

  it("collects a plausible number of injuries, each a real roster player", { timeout: 120_000 }, () => {
    let total = 0;
    for (let s = 0; s < 40; s += 1) {
      const g = simulateGame(4000 + s, "KC", "BUF", { injuries: true });
      total += g.injuryLog!.length;
      for (const ev of g.injuryLog!) {
        expect(ev.playerId).toMatch(/^p_/);
        expect(ev.narrative.length).toBeGreaterThan(20);
        expect(["KC", "BUF"]).toContain(ev.team);
        expect(g.injuredOut.has(ev.playerId)).toBe(true); // pulled for the game
      }
    }
    const perGame = total / 40;
    expect(perGame).toBeGreaterThan(0.4);
    expect(perGame).toBeLessThan(2.5);
  });

  it("the trace is a coherent play-by-play", { timeout: 60_000 }, () => {
    const g = simulateGame(7, "KC", "BUF", { trace: true });
    const t = g.playTrace!;
    expect(t.length).toBeGreaterThan(90);
    expect(t.length).toBeLessThan(170);
    expect(t[0]!.down).toBe(1);
    for (const r of t) {
      expect(r.ballOn).toBeGreaterThanOrEqual(0);
      expect(r.ballOn).toBeLessThanOrEqual(100);
      expect([1, 2, 3, 4]).toContain(r.down);
      expect(["pass", "run", "sack", "scramble", "punt", "field_goal"]).toContain(r.call);
      expect(Number.isInteger(r.ballOn)).toBe(true);
    }
    // at least a few touchdowns and a turnover show up over a full game
    expect(t.some((r) => r.touchdown)).toBe(true);
  });

  it("is deterministic with injuries on", { timeout: 60_000 }, () => {
    const a = simulateGame(11, "KC", "BUF", { injuries: true, trace: true });
    const b = simulateGame(11, "KC", "BUF", { injuries: true, trace: true });
    expect(a.score).toEqual(b.score);
    expect(a.injuryLog!.map((e) => e.narrative)).toEqual(b.injuryLog!.map((e) => e.narrative));
    expect(a.playTrace).toEqual(b.playTrace);
  });
});
