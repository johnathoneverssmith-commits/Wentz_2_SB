/**
 * Playing a week, once the league is ready for it.
 *
 * This is the biggest behavioural change from the dev adapter. There,
 * `/simulate-week` was a pure function: the client sent rosters, got scores
 * back, and kept the results itself. Here the server owns the rosters, picks
 * the moment, runs the week, and persists what happened — because with eight
 * GMs there is no single client that could be trusted to do any of that.
 *
 * The engine is used exactly as it always has been: `simulateGame` is a pure
 * function of a seed and two rosters, and that stays true. What changed is
 * only who calls it and where the answer goes.
 */
import { simulateGame } from "../../src/engine/sim.js";
import { Roster } from "../../src/engine/roster.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

import {
  ROUND_ORDER,
  type GameResult,
  type LeagueState,
  type PlayoffRound,
} from "@/domain";
import { availableRoster } from "@/state/injuries.ts";
import { buildNextRound } from "@/sim/MockSimulationService";
import { humanGate, isInSeason } from "@/state/rules.ts";

import { ActionError, withLeague, type Applied } from "./db.js";
import { deadlineFor, finishPlayedWeek } from "./phases.js";

/** The engine spells the Rams "LA"; this UI spells them "LAR". */
const toEngine = (code: string): string => (code === "LAR" ? "LA" : code);

/**
 * Deterministic per league, season, week and matchup.
 *
 * Two GMs hitting "simulate" a second apart must not produce two different
 * weeks, and a week replayed after a crash must come out identical — both
 * fall out of the seed being a function of the fixture rather than the clock.
 */
function gameSeed(state: LeagueState, week: number, phase: string, home: string, away: string): number {
  const key = `${state.season}|${week}|${phase}|${home}|${away}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Runs the current week for a league, if every human GM has readied up.
 *
 * Idempotent by construction: it refuses when the week's games are already
 * on file, so a second click, a retried request or two GMs pressing at once
 * all produce one week.
 */
export interface WeekOutcome {
  played: boolean;
  reason: string | null;
  week: number;
  results: number;
}

/**
 * Play the live matchups of the current playoff round, with the real engine.
 *
 * The regular season online is played by `simulateGame` against the rosters
 * the GMs actually built, and the playoffs had no server path at all — the
 * week simulator only ever looks at PRE/REG fixtures, so a league that
 * reached the bracket found nothing to play and stopped there.
 *
 * The bracket's shape (seeding, who meets whom next) comes from the same
 * helpers the single-player game uses. Only the result of each game is taken
 * from the engine rather than a coin flip, so a playoff game is decided the
 * same way every other game in the league was.
 */
function playPlayoffRound(state: LeagueState, rosterFor: (code: string) => Roster): number {
  const bracket = state.bracket;
  if (!bracket) return 0;
  const round = bracket.currentRound;
  const live = bracket.matchups.filter((m) => m.round === round && m.winner == null);

  let played = 0;
  for (const m of live) {
    if (!m.highSeed || !m.lowSeed) {
      // a bye: somebody advances without playing
      m.winner = m.highSeed?.code ?? m.lowSeed?.code ?? null;
      continue;
    }
    // the higher seed hosts every round but the Super Bowl
    const home = m.highSeed.code;
    const away = m.lowSeed.code;
    const seed = gameSeed(state, 0, `PO-${round}`, home, away);
    const sim = simulateGame(seed, toEngine(home), toEngine(away), {
      homeRoster: rosterFor(home),
      awayRoster: rosterFor(away),
      neutralSite: round === "SB",
      injuries: true,
    });
    let [hs, as] = [sim.score[0], sim.score[1]];
    // somebody has to go home; break a tie with the seed rather than leaving
    // the bracket with no winner
    if (hs === as) hs += 1;
    m.homeScore = hs;
    m.awayScore = as;
    m.winner = hs > as ? home : away;
    played++;
  }

  const next = ROUND_ORDER[ROUND_ORDER.indexOf(round) + 1] as PlayoffRound | undefined;
  if (round === "SB") {
    bracket.champion = bracket.matchups.find((x) => x.round === "SB")?.winner ?? null;
  } else if (next) {
    bracket.currentRound = next;
    bracket.matchups.push(...buildNextRound(next, bracket, state));
  }
  return played;
}

export async function simulateWeekForLeague(leagueId: string): Promise<WeekOutcome> {
  const { result } = await withLeague<WeekOutcome>(leagueId, async ({ state, league }) => {
    if (!isInSeason(state.stage)) {
      return {
        result: { played: false, reason: "It isn't a game week.", week: state.week, results: 0 },
        state,
      } satisfies { result: WeekOutcome } & Applied;
    }
    if (!humanGate(state)) {
      const waiting = state.gms.filter((g) => g.isHuman && g.teamCode && !state.readiness[g.id]);
      return {
        result: {
          played: false,
          reason: `Still waiting on ${waiting.map((g) => g.teamCode).join(", ")}.`,
          week: state.week,
          results: 0,
        },
        state,
      } satisfies { result: WeekOutcome } & Applied;
    }

    const rosterFor = (code: string): Roster => {
      const squad = availableRoster(
        Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent),
      );
      return new Roster(
        toEngine(code),
        squad as unknown as EnginePlayer[],
        state.depthChart[code] as Record<string, readonly string[]> | undefined,
      );
    };

    // The playoffs are not a week of fixtures; they are a round of a bracket,
    // and the slate below would never find them.
    if (state.stage === "playoffs") {
      if (!state.bracket) {
        return {
          result: { played: false, reason: "The bracket isn't set yet.", week: state.week, results: 0 },
          state,
        } satisfies { result: WeekOutcome } & Applied;
      }
      const round = state.bracket.currentRound;
      const games = playPlayoffRound(state, rosterFor);
      if (games === 0 && !state.bracket.champion) {
        return {
          result: { played: false, reason: "That round has already been played.", week: state.week, results: 0 },
          state,
        } satisfies { result: WeekOutcome } & Applied;
      }
      const moved = finishPlayedWeek(state);
      return {
        result: { played: true, reason: null, week: state.week, results: games },
        state,
        phaseEndsAt: deadlineFor(state, league),
        events: [
          { kind: "season.playoffs", summary: `The ${round} round was played — ${games} games.` },
          ...(state.bracket.champion
            ? [{ kind: "season.champion", summary: `${state.bracket.champion} won the Super Bowl.` }]
            : []),
          { kind: "season.advanced", summary: `The league moved on to ${moved.stage}.` },
        ],
      } satisfies { result: WeekOutcome } & Applied;
    }

    const phase = state.stage === "preseason" ? "PRE" : "REG";
    const slate = state.schedule.filter((g) => g.week === state.week && g.phase === phase);
    const already = new Set(state.games.filter((g) => g.week === state.week && g.phase === phase).map((g) => g.id));
    const todo = slate.filter((g) => !already.has(`${state.season}-${phase}-${state.week}-${g.homeTeam}-${g.awayTeam}`));
    if (todo.length === 0) {
      return {
        result: { played: false, reason: "That week has already been played.", week: state.week, results: 0 },
        state,
      } satisfies { result: WeekOutcome } & Applied;
    }

    const results: GameResult[] = [];
    for (const g of todo) {
      const seed = gameSeed(state, state.week, phase, g.homeTeam, g.awayTeam);
      const sim = simulateGame(seed, toEngine(g.homeTeam), toEngine(g.awayTeam), {
        homeRoster: rosterFor(g.homeTeam),
        awayRoster: rosterFor(g.awayTeam),
        trace: true,
        injuries: true,
      });
      results.push({
        id: `${state.season}-${phase}-${state.week}-${g.homeTeam}-${g.awayTeam}`,
        week: state.week,
        phase,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        played: true,
        homeScore: sim.score[0],
        awayScore: sim.score[1],
        injuries: (sim.injuryLog ?? []) as NonNullable<GameResult["injuries"]>,
      });
    }

    const { applyInjuries } = await import("@/state/injuries.ts");
    const { accrueSeasonStats, recomputeStandings } = await import("@/state/standings.ts");
    state.games.push(...results);
    applyInjuries(state, results, state.season);
    if (phase === "REG") {
      accrueSeasonStats(state, results);
      recomputeStandings(state);
    }

    // The week is played; now the league has to move off it. Single-player
    // the Game Day screen does this on "continue"; online nothing did, so the
    // next request found the games already on file and refused to play them
    // again — which is correct, and left the league on week one for good.
    const playedWeek = state.week;
    const moved = finishPlayedWeek(state);

    return {
      result: { played: true, reason: null, week: playedWeek, results: results.length },
      state,
      phaseEndsAt: deadlineFor(state, league),
      events: [
        {
          kind: "season.week",
          summary: `Week ${playedWeek} was played — ${results.length} games.`,
        },
        {
          kind: "season.advanced",
          summary:
            moved.stage === "playoffs"
              ? "The regular season is over — the bracket is set."
              : `The league moved on to ${moved.stage} week ${moved.week}.`,
        },
      ],
    } satisfies { result: WeekOutcome } & Applied;
  });
  return result;
}

export { ActionError };
