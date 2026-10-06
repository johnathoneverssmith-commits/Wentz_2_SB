import { expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { emptyReveal } from "@/state/reveal.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { simulateBlock } from "../src/blocks.js";
import { decideGamePlan } from "../src/decide.js";
import { playNextPlayoffRound } from "../src/phases.js";

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
const actor = (s: LeagueState, i: number) => ({ userId: "u", leagueId: "l", gmId: s.gms[i]!.id, teamCode: s.gms[i]!.teamCode });
const gameOf = (s: LeagueState, round: string, team: string) =>
  s.games.find((g) => g.phase === round && (g.homeTeam === team || g.awayTeam === team));

it("plays one round per checkpoint, each with the plan saved before it", () => {
  const { s, mine } = playoffs();
  decideGamePlan(s, actor(s, 0), { passRate: 10, blitz: 40 });
  expect(playNextPlayoffRound(s)).toBe(true);
  expect(s.games.some((g) => g.phase === "DIV")).toBe(false);
  const wc = gameOf(s, "WC", mine)!;
  const side = wc.homeTeam === mine ? "home" : "away";
  expect(wc.plans?.[side]?.passRate).toBe(10);

  // between rounds, a different plan for the next game
  decideGamePlan(s, actor(s, 0), { passRate: -10, blitz: -40 });
  playNextPlayoffRound(s);
  const div = gameOf(s, "DIV", mine);
  if (div) {
    const side2 = div.homeTeam === mine ? "home" : "away";
    expect(div.plans?.[side2]?.passRate).toBe(-10);
    expect(div.plans?.[side2]?.blitz).toBe(-40);
  }
});

it("a GM who is out stands ready; one still alive is asked again", () => {
  const { s } = playoffs();
  // round by round to a champion, checking who the next checkpoint waits on
  for (let i = 0; i < 6 && !s.bracket!.champion; i++) {
    playNextPlayoffRound(s);
    const b = s.bracket!;
    if (b.champion) break;
    const alive = new Set(
      b.matchups.filter((m) => m.round === b.currentRound && m.winner == null).flatMap((m) => [m.highSeed?.code, m.lowSeed?.code]),
    );
    for (const g of s.gms.filter((x) => x.isHuman)) {
      expect(s.readiness[g.id], `${g.teamCode} in ${b.currentRound}`).toBe(!alive.has(g.teamCode));
    }
  }
  expect(s.bracket!.champion).toBeTruthy();
  // and the champion is decided once: another checkpoint plays nothing
  const games = s.games.length;
  expect(playNextPlayoffRound(s)).toBe(false);
  expect(s.games.length).toBe(games);
});
