import { broadcastGame } from "../../src/engine/broadcast.js";
import { simulateGame } from "../../src/engine/sim.js";
import { Roster } from "../../src/engine/roster.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

import { ROUND_ORDER } from "@/domain";
import type { GameResult, LeagueState, Player as UiPlayer } from "@/domain";
import { buildNextRound } from "@/sim/MockSimulationService";
import { availableRoster, applyInjuries, healOneWeek } from "@/state/injuries.ts";
import { makeEmergencyPlayer, positionalMinimums } from "@/state/reconciliation.ts";
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
 * Enough bodies at every position to finish the game, and not one more.
 *
 * Weeks 1 through 9 are locked — no signings, no promotions, no waiver
 * claims — so a run of injuries at one position can leave a team with nobody
 * to line up there. The simulation still has to produce a game, so it gets
 * 0 OVR placeholders.
 *
 * They exist for the length of one `simulateGame` call and nowhere else.
 * Not in `state.players`, not on the roster, not against the cap, not in the
 * transaction log, and never carrying a statistic into a season total — a
 * placeholder that got saved would be a 0 OVR quarterback who could then be
 * traded, and that is a worse bug than a team playing a man short.
 */
function withPlaceholders(
  state: LeagueState,
  teamCode: string,
  squad: UiPlayer[],
): UiPlayer[] {
  const mins = positionalMinimums();
  const out = [...squad];
  for (const [pos, need] of Object.entries(mins)) {
    let have = out.filter((p) => p.position === pos).length;
    while (have < need) {
      // deliberately not written into state.players
      out.push(makeEmergencyPlayer(state, teamCode, pos, have));
      have++;
    }
  }
  return out;
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
    return {
      squad: withPlaceholders(state, code, squad),
      sidelined: all.filter((p) => !dressed.has(p.id)).map((p) => p.id),
    };
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
    const squad = withPlaceholders(
      state,
      code,
      Object.values(state.players).filter(
        (p) => p.nfl_team === code && !p.retired && !p.free_agent && !out.has(p.id),
      ),
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

/**
 * Play the whole postseason, once, at the checkpoint that opens it.
 *
 * Change 11: the playoffs get the same treatment the regular season already
 * has. Four rounds are decided here, in order, each from the winners of the
 * last, and every GM afterwards reveals them one round at a time at their own
 * pace. It has to happen in one pass because a bracket cannot be built
 * halfway — the divisional round does not exist until the wild card is
 * settled, so there is no partial state worth saving.
 *
 * Unlike the regular season these are written as `GameResult`s as well as
 * bracket matchups. The bracket is what the postseason *looks* like; the
 * games are what every other screen in the app already knows how to read —
 * box scores, statistics, and the reveal filter, which keys playoff games off
 * their round rather than their week.
 */
export function simulatePlayoffBlock(state: LeagueState): number {
  const bracket = state.bracket;
  if (!bracket) return 0;

  const squadFor = (code: string) => {
    const all = Object.values(state.players).filter(
      (p) => p.nfl_team === code && !p.retired && !p.free_agent,
    );
    const squad = availableRoster(all);
    const dressed = new Set(squad.map((p) => p.id));
    return {
      squad: withPlaceholders(state, code, squad),
      sidelined: all.filter((p) => !dressed.has(p.id)).map((p) => p.id),
    };
  };
  const rosterOf = (code: string, squad: { id: string }[]): Roster =>
    new Roster(
      toEngine(code),
      squad as unknown as EnginePlayer[],
      state.depthChart[code] as Record<string, readonly string[]> | undefined,
    );

  let played = 0;
  // four rounds, plus a stop in case a bracket ever fails to advance
  for (let guard = 0; guard < ROUND_ORDER.length + 1; guard++) {
    const round = bracket.currentRound;
    const live = bracket.matchups.filter((m) => m.round === round && m.winner == null);
    const results: GameResult[] = [];

    for (const m of live) {
      if (!m.highSeed || !m.lowSeed) {
        // the one seed's bye: they advance without a game, and there is no
        // box score to write because no football was played
        m.winner = m.highSeed?.code ?? m.lowSeed?.code ?? null;
        continue;
      }
      const home = m.highSeed.code;
      const away = m.lowSeed.code;
      const id = `${state.season}-${round}-${home}-${away}`;
      if (state.games.some((g) => g.id === id)) continue;

      const seed = gameSeed(state, 0, `PO-${round}`, home, away);
      const h = squadFor(home);
      const a = squadFor(away);
      const sim = simulateGame(seed, toEngine(home), toEngine(away), {
        homeRoster: rosterOf(home, h.squad),
        awayRoster: rosterOf(away, a.squad),
        neutralSite: round === "SB",
        trace: true,
        injuries: true,
      });
      let [hs, as] = [sim.score[0], sim.score[1]];
      // somebody has to go home; break a tie with the seed rather than
      // leaving the bracket without a winner
      if (hs === as) hs += 1;

      m.homeScore = hs;
      m.awayScore = as;
      m.winner = hs > as ? home : away;
      results.push({
        id,
        week: 0,
        phase: round,
        homeTeam: home,
        awayTeam: away,
        played: true,
        homeScore: hs,
        awayScore: as,
        injuries: (sim.injuryLog ?? []) as NonNullable<GameResult["injuries"]>,
        sidelined: { home: h.sidelined, away: a.sidelined },
      });
      played++;
    }

    if (results.length > 0) {
      state.games.push(...results);
      applyInjuries(state, results, state.season);
    }

    const next = ROUND_ORDER[ROUND_ORDER.indexOf(round) + 1] as
      | (typeof ROUND_ORDER)[number]
      | undefined;
    if (round === "SB") {
      bracket.champion = bracket.matchups.find((x) => x.round === "SB")?.winner ?? null;
      break;
    }
    if (!next) break;
    bracket.currentRound = next;
    bracket.matchups.push(...buildNextRound(next, bracket, state));
    // a round has passed for everybody, hurt or not
    healOneWeek(state);
  }
  return played;
}
