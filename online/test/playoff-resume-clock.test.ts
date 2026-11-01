import { expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal } from "@/state/reveal.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { simulateBlock } from "../src/blocks.js";
import { readyUpLocal } from "../src/phases.js";

/**
 * The postseason is a round at a time, each round a checkpoint: a GM still
 * alive sets a plan for their next game, everyone checks in, and that round
 * is played with the plans saved at that moment. A GM who is out never holds
 * the league up.
 */
function playoffs(): { s: LeagueState; mine: string; other: string } {
  const s = createLeague(4242, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(s);
  const sim = new MockSimulationService();
  s.schedule = sim.generateSchedule(s.season, Object.keys(s.teams));
  s.stage = "regularSeason";
  s.reveal = emptyReveal();
  simulateBlock(s, "REG", 1, 2);
  s.bracket = sim.seedBracket(s);
  s.stage = "playoffs";
  // the humans: two teams that play on wild-card weekend
  const wc = s.bracket.matchups.filter((m) => m.round === "WC" && m.highSeed && m.lowSeed);
  const mine = wc[0]!.highSeed!.code;
  const other = wc[wc.length - 1]!.lowSeed!.code;
  for (const g of s.gms) g.isHuman = false;
  s.gms[0]!.isHuman = true;
  s.gms[0]!.teamCode = mine;
  s.gms[1]!.isHuman = true;
  s.gms[1]!.teamCode = other;
  for (const c of Object.keys(s.teams)) s.teams[c]!.controlledBy = { kind: "ai" };
  s.teams[mine]!.controlledBy = { kind: "human", gmId: s.gms[0]!.id };
  s.teams[other]!.controlledBy = { kind: "human", gmId: s.gms[1]!.id };
  return { s, mine, other };
}

/**
 * Codex P2 on the pause work: a vacate (or a resume) that leaves every remaining GM ready plays the next playoff round
 * through `readyUpLocal`. The stage stays `playoffs`, so "progress" has to include a round played, or the caller keeps the old
 * checkpoint's nearly expired clock for the next one.
 */
it("readyUpLocal reports progress when it plays a playoff round (stage unchanged)", () => {
  const { s } = playoffs();
  for (const g of s.gms.filter((x) => x.isHuman)) s.readiness[g.id] = true;
  const gamesBefore = s.games.length;
  const progressed = readyUpLocal(s);
  expect(s.stage).toBe("playoffs");
  expect(s.games.length, "the round was played").toBeGreaterThan(gamesBefore);
  expect(progressed, "and the caller is told, so the next checkpoint gets its own clock").toBe(true);
});

it("readyUpLocal reports nothing when someone is still unready", () => {
  const { s } = playoffs();
  const humans = s.gms.filter((x) => x.isHuman);
  s.readiness[humans[0]!.id] = true;
  s.readiness[humans[1]!.id] = false;
  const gamesBefore = s.games.length;
  expect(readyUpLocal(s)).toBe(false);
  expect(s.games.length, "no round was played").toBe(gamesBefore);
});
