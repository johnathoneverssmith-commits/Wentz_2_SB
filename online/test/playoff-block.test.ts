import { describe, expect, it } from "vitest";

import { ROUND_ORDER, type LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal, markRoundRevealed, visibleBracket, visibleGames } from "@/state/reveal.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { simulateBlock, simulatePlayoffBlock } from "../src/blocks.js";

/**
 * Change 11 — the postseason, decided once and watched four times.
 *
 * The bracket is the thing that can leak. Every other screen reads
 * `visibleGames`, but a bracket is drawn from saved matchups that hold the
 * champion the moment the checkpoint closes, so the masking is what stands
 * between a GM and the Super Bowl result before they have watched the wild
 * card.
 */
function seeded(): LeagueState {
  const s = createLeague(4242, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  s.gms[0]!.teamCode = "KC";
  s.gms[0]!.isHuman = true;
  s.gms[1]!.teamCode = "BUF";
  s.gms[1]!.isHuman = true;
  const sim = new MockSimulationService();
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  s.week = 1;
  s.reveal = emptyReveal();
  // a couple of weeks is enough to give the seeder a standings table to read
  simulateBlock(s, "REG", 1, 2);
  s.bracket = sim.seedBracket(s);
  return s;
}

describe("simulating the postseason up front", () => {
  it("plays every round through to a champion", () => {
    const s = seeded();
    const played = simulatePlayoffBlock(s);

    expect(played).toBeGreaterThan(0);
    expect(s.bracket!.champion).toBeTruthy();
    for (const round of ROUND_ORDER) {
      expect(s.games.some((g) => g.phase === round)).toBe(true);
    }
  }, 600_000);

  it("writes games, not just matchups, so a box score exists for each", () => {
    const s = seeded();
    simulatePlayoffBlock(s);
    const sb = s.games.find((g) => g.phase === "SB")!;
    expect(sb.played).toBe(true);
    expect(sb.homeScore).not.toBe(sb.awayScore);
    // the tie-break is real: somebody has to go home
    expect(s.bracket!.champion).toBe(sb.homeScore > sb.awayScore ? sb.homeTeam : sb.awayTeam);
  }, 600_000);
});

describe("what a GM can see", () => {
  it("hides every round until it is revealed", () => {
    const s = seeded();
    simulatePlayoffBlock(s);
    const gm = s.gms[0]!.id;

    const blind = visibleBracket(s.bracket!, s, gm);
    expect(blind.champion).toBeNull();
    expect(blind.matchups.every((m) => m.winner === null)).toBe(true);
    expect(visibleGames(s, gm).filter((g) => ROUND_ORDER.includes(g.phase as never))).toHaveLength(
      0,
    );
  }, 600_000);

  it("opens one round at a time and nobody else's", () => {
    const s = seeded();
    simulatePlayoffBlock(s);
    const [a, b] = [s.gms[0]!.id, s.gms[1]!.id];

    markRoundRevealed(s, a, "WC");
    const mine = visibleBracket(s.bracket!, s, a);
    expect(mine.matchups.some((m) => m.round === "WC" && m.winner)).toBe(true);
    expect(mine.matchups.some((m) => m.round === "DIV" && m.winner)).toBe(false);
    expect(mine.champion).toBeNull();

    // the other GM has not moved
    expect(visibleBracket(s.bracket!, s, b).matchups.every((m) => m.winner === null)).toBe(true);
  }, 600_000);

  it("gives up the champion only with the Super Bowl", () => {
    const s = seeded();
    simulatePlayoffBlock(s);
    const gm = s.gms[0]!.id;
    for (const r of ROUND_ORDER) markRoundRevealed(s, gm, r);
    expect(visibleBracket(s.bracket!, s, gm).champion).toBe(s.bracket!.champion);
  }, 600_000);
});
