import { describe, expect, it } from "vitest";

import type { LeagueState, Player } from "@/domain";
import { openStandingMarketFromUndrafted } from "@/state/rules.ts";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";
import { onStageEntered } from "../src/phases.js";

import { Roster } from "../../src/engine/roster.js";
import { simulateGame } from "../../src/engine/sim.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

/**
 * Master has to actually win.
 *
 * The same league — same seed, same player pool, same draft order — is
 * fantasy-drafted twice: once by Expert CPUs, once by Master ones. Then
 * every Master-built team plays the Expert-built team that drafted from
 * the same slot, home and away, on the real engine. The only difference
 * between the two rosters is how their GM valued players, so the result is
 * a straight measure of the evaluator.
 *
 * Expert already makes no mistakes with the ratings-first model; Master
 * reads units the way the engine's synergy layer scores them. If that is
 * worth anything on the field, it shows up here.
 */
function drafted(difficulty: "expert" | "master"): LeagueState {
  const s = createLeague(777, { ...DEFAULT_CONFIG, humanGmCount: 1, difficulty });
  for (const g of s.gms) g.isHuman = false; // every team is a CPU GM
  s.stage = "fantasyDraft";
  // opening the stage builds the board and, with nobody human, drafts it out
  onStageEntered(s, "setup");
  expect(s.draft!.currentPickIndex).toBe(s.draft!.pickOrder.length);
  // leaving the draft fills every roster to 53 the same way in both leagues
  openStandingMarketFromUndrafted(s);
  fillRosterGaps(s);
  return s;
}

const GAMES_PER_SLOT = 10;
/** Talent impact to play at; the assertion below is at the validated engine. */
const TALENT = Number(process.env.MASTER_TALENT ?? "1");

const rosterOf = (s: LeagueState, code: string, tag: string): Roster =>
  new Roster(
    code,
    Object.values(s.players)
      .filter((p: Player) => p.nfl_team === code && !p.retired && !p.free_agent)
      .map((p) => ({ ...p, id: `${p.id}${tag}` })) as unknown as EnginePlayer[],
  );

describe("the Master AI", () => {
  it("builds teams that beat Expert-built teams from the same draft slot", () => {
    const expert = drafted("expert");
    const master = drafted("master");
    const codes = Object.keys(expert.teams);

    let wins = 0;
    let losses = 0;
    let margin = 0;
    for (const code of codes) {
      const a = rosterOf(master, code, "~i");
      const b = rosterOf(expert, code, "~e");
      for (let k = 0; k < GAMES_PER_SLOT; k++) {
        const home = k % 2 === 0;
        const g = home
          ? simulateGame(9000 + k * 131 + code.charCodeAt(0), code, code, { homeRoster: a, awayRoster: b, talentScale: TALENT })
          : simulateGame(9000 + k * 131 + code.charCodeAt(0), code, code, { homeRoster: b, awayRoster: a, talentScale: TALENT });
        const [mine, theirs] = home ? [g.score[0], g.score[1]] : [g.score[1], g.score[0]];
        if (mine > theirs) wins++;
        else if (mine < theirs) losses++;
        margin += mine - theirs;
      }
    }
    const games = codes.length * GAMES_PER_SLOT;
    // eslint-disable-next-line no-console
    console.log(`[talent ${TALENT}] Master vs Expert, same draft slot: ${wins}-${losses} (${games} games), avg margin ${(margin / games).toFixed(1)}`);
    // Measured 178-140 (56%), +2.1 a game. That is the ceiling a CPU that
    // follows the same rules can reach against Expert: both draft one shared
    // pool and Expert's ratings-first judgment is already sound, so a better
    // evaluator buys a consistent edge, not dominance. Deterministic seeds —
    // this guards that the edge exists, not its exact size.
    expect(wins / (wins + losses)).toBeGreaterThan(0.53);
  }, 900_000);
});
