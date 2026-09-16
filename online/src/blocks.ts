import { broadcastGame } from "../../src/engine/broadcast.js";
import { simulateGame } from "../../src/engine/sim.js";
import { Roster } from "../../src/engine/roster.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

import type { GameResult, LeagueState } from "@/domain";
import { availableRoster, applyInjuries, healOneWeek } from "@/state/injuries.ts";
import { accrueSeasonStats, recomputeStandings } from "@/state/standings.ts";

/** The engine spells the Rams "LA"; this UI spells them "LAR". */
const toEngine = (code: string): string => (code === "LAR" ? "LA" : code);

/**
 * Deterministic per league, season, week and matchup — the same seed the live
 * week simulator uses, so a block and a live week produce identical games.
 */
function gameSeed(
  state: LeagueState,
  week: number,
  phase: string,
  home: string,
  away: string,
): number {
  const key = `${state.season}|${week}|${phase}|${home}|${away}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Play a whole block of weeks up front, into saved state.
 *
 * Change 6 onward, a block is simulated once at the checkpoint that opens it
 * and every control afterwards only reveals what is already here. This is the
 * function that does the simulating. It writes scores, injuries, statistics
 * and standings — but no play-by-play, which is regenerated on demand from
 * each game's seed. A broadcast is ~44KB and the league travels whole on
 * every request; a hundred and forty of them would put six megabytes into it
 * for something most GMs open perhaps twice.
 *
 * Returns how many games it played, so the caller can say so and so a retry
 * after a failure can tell "nothing happened" from "half of it happened".
 */
export function simulateBlock(
  state: LeagueState,
  phase: "PRE" | "REG",
  fromWeek: number,
  toWeek: number,
): number {
  const squadFor = (code: string) => {
    const all = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent,
    );
    const squad = availableRoster(all);
    const dressed = new Set(squad.map((p) => p.id));
    return { squad, sidelined: all.filter((p) => !dressed.has(p.id)).map((p) => p.id) };
  };

  const rosterOf = (code: string, squad: { id: string }[]): Roster =>
    new Roster(
      toEngine(code),
      squad as unknown as EnginePlayer[],
      state.depthChart[code] as Record<string, readonly string[]> | undefined,
    );

  let played = 0;
  for (let week = fromWeek; week <= toWeek; week++) {
    const slate = state.schedule.filter((g) => g.week === week && g.phase === phase);
    const already = new Set(
      state.games.filter((g) => g.week === week && g.phase === phase).map((g) => g.id),
    );

    const results: GameResult[] = [];
    for (const g of slate) {
      const id = `${state.season}-${phase}-${week}-${g.homeTeam}-${g.awayTeam}`;
      if (already.has(id)) continue;
      const seed = gameSeed(state, week, phase, g.homeTeam, g.awayTeam);
      const home = squadFor(g.homeTeam);
      const away = squadFor(g.awayTeam);
      const sim = simulateGame(seed, toEngine(g.homeTeam), toEngine(g.awayTeam), {
        homeRoster: rosterOf(g.homeTeam, home.squad),
        awayRoster: rosterOf(g.awayTeam, away.squad),
        trace: true,
        injuries: true,
      });
      results.push({
        id,
        week,
        phase,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        played: true,
        homeScore: sim.score[0],
        awayScore: sim.score[1],
        injuries: (sim.injuryLog ?? []) as NonNullable<GameResult["injuries"]>,
        sidelined: { home: home.sidelined, away: away.sidelined },
      });
      played++;
    }

    if (results.length === 0) continue;
    state.games.push(...results);
    applyInjuries(state, results, state.season);
    if (phase === "REG") {
      accrueSeasonStats(state, results);
      recomputeStandings(state);
    }
    // injuries heal between weeks the same way they would have if the weeks
    // had been played one at a time — the block must be indistinguishable
    // from having played it live, or the reveal shows a different season
    healOneWeek(state);
  }
  return played;
}


/**
 * The play-by-play for one already-played game, rebuilt rather than read.
 *
 * The block saved the score and threw the trace away, so this re-runs the
 * game from the same seed against the same two lineups. It is exact, not
 * approximate: the seed is a pure function of the matchup, ratings do not
 * move during a season, and the one thing that does move between weeks —
 * who was hurt — was written down at the time.
 *
 * Nothing here touches `state`. A GM watching week three cannot change week
 * four by watching it.
 */
export function regenerateBroadcast(state: LeagueState, gameId: string) {
  const game = state.games.find((g) => g.id === gameId);
  if (!game || !game.played) return null;

  const out = new Set([...(game.sidelined?.home ?? []), ...(game.sidelined?.away ?? [])]);
  const rosterFor = (code: string): Roster => {
    const squad = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent && !out.has(p.id),
    );
    return new Roster(
      toEngine(code),
      squad as unknown as EnginePlayer[],
      state.depthChart[code] as Record<string, readonly string[]> | undefined,
    );
  };

  const seed = gameSeed(state, game.week, game.phase, game.homeTeam, game.awayTeam);
  const cast = broadcastGame(seed, toEngine(game.homeTeam), toEngine(game.awayTeam), {
    homeRoster: rosterFor(game.homeTeam),
    awayRoster: rosterFor(game.awayTeam),
  });
  // the engine spells the Rams differently; the UI should never see that
  const toUi = (c: string): string => (c === "LA" ? "LAR" : c);
  return {
    ...cast,
    home: game.homeTeam,
    away: game.awayTeam,
    drives: cast.drives.map((d) => ({ ...d, team: toUi(d.team) })),
    injuries: cast.injuries.map((i) => ({ ...i, team: toUi(i.team) })),
  };
}
