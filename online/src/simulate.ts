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
import { talentScaleOf } from "@/state/talentImpact.ts";
import { staffPairOf } from "./staffs.js";
import { boxScoreOf, trimStoredBoxScores } from "./boxscore.js";
import { simulateGame } from "../../src/engine/sim.js";
import { broadcastGame } from "../../src/engine/broadcast.js";
import { Roster } from "../../src/engine/roster.js";
import type { Player as EnginePlayer } from "../../src/schema/player.js";

import { type GameResult, type LeagueState } from "@/domain";
import { availableRoster } from "@/state/injuries.ts";
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

/** The week that just closed, for reporting. */
function playedWeekOf(state: LeagueState, moved: { week: number }): number {
  return moved.week > 1 ? moved.week - 1 : state.week;
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

    const squads = new Map<string, ReturnType<typeof availableRoster>>();
    const rosterFor = (code: string): Roster => {
      const squad = availableRoster(
        Object.values(state.players).filter((p) => p.nfl_team === code && !p.retired && !p.free_agent),
      );
      squads.set(code, squad);
      return new Roster(
        toEngine(code),
        squad as unknown as EnginePlayer[],
        state.depthChart[code] as Record<string, readonly string[]> | undefined,
      );
    };

    // The whole postseason is decided once, in one pass, the moment the
    // playoffs stage opens (`onStageEntered` -> `simulatePlayoffBlock`,
    // phases.ts) — the same "simulate the block at the checkpoint, reveal it
    // after" design the rest of the season uses, and there is no partial
    // bracket state worth a request like this one acting on. This branch
    // used to play one round per request, from before that design existed;
    // nothing reaches this function while the league is still in the
    // playoffs stage without `state.bracket.champion` already set. It stays
    // as an inert refusal — never as a second place that can move the
    // bracket or announce the champion — because "nothing currently calls
    // this that way" is a property of the surrounding request flow, not a
    // rule this function enforces, and a future change to that flow must
    // not be able to turn this back into a second, ungated way to resolve
    // or re-announce a postseason the checkpoint already decided.
    if (state.stage === "playoffs") {
      return {
        result: {
          played: false,
          reason: "The postseason is decided at the checkpoint, not here.",
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
      // The slate is done but the league is still sitting on this week, which
      // means it was played before the server knew to step the clock. Refusing
      // here is what made those leagues unplayable: every ready-up returned
      // "already played" and returned *before* the advance, so the week never
      // moved and the standings never changed again. The games are finished —
      // what is missing is the week ending, so end it.
      const moved = finishPlayedWeek(state);
      return {
        result: { played: false, reason: null, week: playedWeekOf(state, moved), results: 0 },
        state,
        phaseEndsAt: deadlineFor(state, league),
        events: [
          {
            kind: "season.advanced",
            summary: `That week was already played — the league moved on to ${moved.stage}${
              moved.stage === "preseason" || moved.stage === "regularSeason"
                ? ` week ${moved.week}`
                : ""
            }.`,
          },
        ],
      } satisfies { result: WeekOutcome } & Applied;
    }

    // Whose game gets a play-by-play. A broadcast is ~44KB, and the league
    // document travels whole on every action and every stream frame — sixteen
    // of them a week, kept for a season, would put six megabytes into it. So
    // only the games a person is actually in get one, and only the current
    // week keeps it.
    const humanTeams = new Set(
      state.gms.filter((gm) => gm.isHuman && gm.teamCode).map((gm) => gm.teamCode),
    );
    for (const old of state.games) delete (old as { broadcast?: unknown }).broadcast;

    const results: GameResult[] = [];
    for (const g of todo) {
      const seed = gameSeed(state, state.week, phase, g.homeTeam, g.awayTeam);
      const homeRoster = rosterFor(g.homeTeam);
      const awayRoster = rosterFor(g.awayTeam);
      const sim = simulateGame(seed, toEngine(g.homeTeam), toEngine(g.awayTeam), {
        homeRoster,
        awayRoster,
        trace: true,
        injuries: true,
        talentScale: talentScaleOf(state.config),
        offenseAdjust: state.offenseAdjust ?? 0,
        overtime: "nfl",
        ...staffPairOf(state, g.homeTeam, g.awayTeam),
      });
      const watched = humanTeams.has(g.homeTeam) || humanTeams.has(g.awayTeam);
      results.push({
        id: `${state.season}-${phase}-${state.week}-${g.homeTeam}-${g.awayTeam}`,
        week: state.week,
        phase,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        played: true,
        homeScore: sim.score[0],
        awayScore: sim.score[1],
        ...boxScoreOf(sim, g.homeTeam, g.awayTeam, state.week, {
          home: squads.get(g.homeTeam) ?? [],
          away: squads.get(g.awayTeam) ?? [],
        }),
        injuries: (sim.injuryLog ?? []) as NonNullable<GameResult["injuries"]>,
        // same seed and the same rosters, so the drives it walks through are
        // the drives that produced the score above
        ...(watched
          ? {
              broadcast: broadcastGame(seed, toEngine(g.homeTeam), toEngine(g.awayTeam), {
                homeRoster,
                awayRoster,
                talentScale: talentScaleOf(state.config),
        offenseAdjust: state.offenseAdjust ?? 0,
                overtime: "nfl",
        ...staffPairOf(state, g.homeTeam, g.awayTeam),
              }) as NonNullable<GameResult["broadcast"]>,
            }
          : {}),
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
    trimStoredBoxScores(results, humanTeams);

    // The week is played; now the league has to move off it. Single-player
    // the Game Day screen does this on "continue"; online nothing did, so the
    // next request found the games already on file and refused to play them
    // again — which is correct, and left the league on week one for good.
    const playedWeek = state.week;
    // What the Game Day screen shows. `viewerGameId` stays null because the
    // league document is shared and "your game" is different for every GM —
    // the client resolves it from its own team against `gameIds`.
    state.pendingGameDay = {
      phase,
      week: playedWeek,
      gameIds: results.map((g) => g.id),
      viewerGameId: null,
    };
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
