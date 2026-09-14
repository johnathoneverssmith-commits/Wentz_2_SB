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

import type { GameResult, LeagueState } from "@/domain";
import { availableRoster } from "@/state/injuries.ts";
import { humanGate, isInSeason } from "@/state/rules.ts";

import { ActionError, withLeague, type Applied } from "./db.js";
import { deadlineFor } from "./phases.js";

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

    return {
      result: { played: true, reason: null, week: state.week, results: results.length },
      state,
      phaseEndsAt: deadlineFor(state, league),
      events: [
        {
          kind: "season.week",
          summary: `Week ${state.week} was played — ${results.length} games.`,
        },
      ],
    } satisfies { result: WeekOutcome } & Applied;
  });
  return result;
}

export { ActionError };
