/**
 * Moving the league forward when everybody is in a different time zone and
 * half of them are asleep.
 *
 * Single-player, a stage advanced the moment the one human clicked ready.
 * Online that model has an obvious failure: one GM who stops logging in
 * freezes a league of eight people indefinitely, and "everyone has to be
 * here" is precisely what asynchronous play is supposed to avoid.
 *
 * So every phase carries a real-world deadline. A GM who shows up acts for
 * themselves; a GM who doesn't gets played by the same AI that runs the
 * unclaimed teams — `planAutopicks` for a draft pick, the bidding resolver
 * for a free-agency day. Nobody is punished for going on holiday, and nobody
 * can hold the league hostage by refusing to click a button.
 *
 * `sweep()` is the whole mechanism. It runs on a timer and, for any league
 * whose deadline has passed, takes the absent GMs' turns and moves on. It is
 * idempotent and takes the same row lock the action endpoints do, so running
 * it twice, or while somebody is mid-action, is safe.
 */
import type { LeagueState } from "@/domain";
import { resolveTransition } from "@/state/stageMachine.ts";
import {
  beginDraft,
  clearReadiness,
  commitRetirements,
  humanGate,
  isInSeason,
  openSlots,
  openStandingMarketFromUndrafted,
  planAutopicks,
  rosterGate,
  runAiPicks,
  sbWonByHuman,
  finalizeSeason,
  signAiDraftPicks,
  applyPick,
} from "@/state/rules.ts";
import { fillRosterGaps, recomputeTeamRatings, trimRosters } from "@/state/seed.ts";

import { clearInjuries, healOneWeek } from "@/state/injuries.ts";
import { ensureDraftPicks, forgetSpentPicks } from "@/state/draftPicks.ts";
import { applySeasonAging, forgetOldRetirees, pruneFreeAgentMarket } from "@/state/seed.ts";
import { resetSeasonStats } from "@/state/standings.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { ActionError, pool, withLeague, type Applied, type LoadedLeague } from "./db.js";

/**
 * Only ever asked for things it computes rather than invents: seeding a
 * bracket from the standings, and building a schedule. The games themselves
 * are played by the real engine in `simulate.ts`.
 */
const sim = new MockSimulationService();

/** How long this stage should stay open for, from now. */
export function deadlineFor(state: LeagueState, league: { phaseTimeoutHours: number; pickTimeoutHours: number }): Date {
  // The draft is the one stage where order matters, so it runs on a shorter,
  // per-pick clock rather than a single deadline for the whole round.
  const hours =
    state.stage === "fantasyDraft" || state.stage === "offseasonDraft"
      ? league.pickTimeoutHours
      : league.phaseTimeoutHours;
  return new Date(Date.now() + hours * 3_600_000);
}

/** Which GMs still have to act before this stage can close. */
export function waitingOn(state: LeagueState): string[] {
  return state.gms
    .filter((g) => g.isHuman && g.teamCode && !state.readiness[g.id])
    .map((g) => g.teamCode);
}

/**
 * Why a stage is being held, when it isn't a GM who hasn't clicked.
 *
 * Only setup has such a reason, and only ever the one: seats nobody has
 * taken. Null means the stage is held by readiness alone, which the GM chips
 * already explain.
 */
export function heldBy(state: LeagueState): { openSlots: number } | null {
  return rosterGate(state) ? null : { openSlots: openSlots(state) };
}

export interface AdvanceOutcome {
  moved: boolean;
  stage: string;
  /** Teams the AI played for because their GM didn't show. */
  autopiloted: string[];
}

/**
 * Marks one GM ready and, if that was the last one, advances the stage.
 *
 * The advance itself is the client's `tryAdvance` minus the client: same
 * transition table, same readiness rule.
 */
export async function readyUp(
  leagueId: string,
  gmId: string,
  ready: boolean,
): Promise<AdvanceOutcome> {
  const { result } = await withLeague(leagueId, async ({ state, league }) => {
    state.readiness[gmId] = ready;
    // `rosterGate` is what stops one GM starting a league by themselves while
    // the other seats are still empty — see its note in `rules.ts`.
    const outcome =
      ready && humanGate(state) && rosterGate(state)
        ? advanceStage(state)
        : { moved: false, autopiloted: [] as string[] };
    return {
      result: { moved: outcome.moved, stage: state.stage, autopiloted: outcome.autopiloted },
      state,
      phaseEndsAt: outcome.moved ? deadlineFor(state, league) : undefined,
      events: outcome.moved
        ? [{ kind: "phase.advanced", summary: `The league moved on to ${state.stage}.` }]
        : [],
    } satisfies { result: AdvanceOutcome } & Applied;
  });
  return result;
}

/**
 * Applies the stage transition to a state in hand.
 *
 * Deliberately thin: the one thing it must not do is re-implement the
 * transition rules, which live in `stageMachine.ts` and are unit-tested
 * there. In-season stages are excluded because a week advances by being
 * *simulated*, not by a gate opening — see `simulateWeek`.
 */
export function advanceStage(state: LeagueState): { moved: boolean; autopiloted: string[] } {
  if (isInSeason(state.stage)) return { moved: false, autopiloted: [] };
  const from = state.stage;
  const t = resolveTransition(state, { humanGmWonSuperBowl: sbWonByHuman(state) });
  if (t.seasonRollover) rollOverSeason(state);
  if (t.resetStats) resetSeasonStats(state);
  state.stage = t.stage;
  state.week = t.week;
  onStageEntered(state, from);
  clearReadinessOnline(state);
  return { moved: true, autopiloted: [] };
}

/**
 * Turn the page on a season.
 *
 * The single-player `tryAdvance` does all of this and online none of it ran,
 * so a league that finished its first year would have walked into the next
 * one carrying last year's schedule, last year's records, last year's
 * injuries and no draft class — which is to say it would not have worked at
 * all. Everything here is deliberate housekeeping rather than rules, and it
 * is kept in the same order as the single-player version so the two leagues
 * age identically.
 */
function rollOverSeason(state: LeagueState): void {
  finalizeSeason(state);
  state.season += 1;
  state.bracket = null;
  state.games = [];
  state.draft = null;
  state.freeAgency = null;
  state.coachingHire = null;
  state.trades = [];
  state.rookieOutcomes = {};
  state.pendingGameDay = null;
  forgetSpentPicks(state, state.season); // that draft has happened
  ensureDraftPicks(state, state.season); // and two more are now tradeable
  clearInjuries(state); // an offseason outlasts any injury
  pruneFreeAgentMarket(state); // careers that stopped going anywhere end
  forgetOldRetirees(state); // and a save shouldn't carry them forever
  applySeasonAging(state, state.season);
  fillRosterGaps(state);
  state.draftClass = sim.generateDraftClass(state.season, state.season);
  for (const code of Object.keys(state.teams)) {
    const team = state.teams[code]!;
    team.wins = team.losses = team.ties = 0;
    team.pointsFor = team.pointsAgainst = 0;
    team.playoffSeed = 0;
  }
  state.schedule = sim.generateSchedule(state.season, Object.keys(state.teams));
}

/**
 * Step the clock once a week has actually been played.
 *
 * Single-player this is `finishGameDay`: the Game Day screen shows the
 * scores, the player hits continue, and the league moves to the next week or
 * out of the season entirely. Online there was no equivalent at all —
 * `simulateWeekForLeague` pushed the results and stopped. The week never
 * advanced, so the next request found the games already on file and answered
 * "that week has already been played", forever. An online league could play
 * week one and nothing else.
 *
 * Kept beside `onStageEntered` because it is the same idea from the other
 * side: that one opens a stage, this one closes a week.
 */
export function finishPlayedWeek(state: LeagueState): { stage: string; week: number } {
  const t = resolveTransition(state, { humanGmWonSuperBowl: sbWonByHuman(state) });
  if (t.stage === "playoffs" && !state.bracket) {
    // seeding is a pure reading of the standings, so the server can do it
    state.bracket = sim.seedBracket(state);
  }
  if (t.resetStats) resetSeasonStats(state);
  healOneWeek(state); // a week has passed; everyone hurt is a week closer
  // the season is scored the moment the playoffs end, so the end-of-season
  // screens have this year's row to show
  if (t.stage === "endOfSeasonAnnounce") finalizeSeason(state);

  const from = state.stage;
  state.stage = t.stage;
  state.week = t.week;
  state.pendingGameDay = null;
  onStageEntered(state, from);
  clearReadinessOnline(state);
  return { stage: state.stage, week: state.week };
}

/**
 * The work a stage needs doing before anybody can play it.
 *
 * Single-player this happens lazily, on the screen: the draft room opens,
 * finds no draft, and makes one. That is fine when there is one client and it
 * owns the league. Online it meant the server advanced into the fantasy draft
 * holding no draft at all — every GM's client built its own private board
 * from its own copy of the league, and the server answered every pick with
 * "there's no draft running". The league became unplayable at exactly the
 * stage the start gate had just worked so hard to enter together.
 *
 * The server owns the league, so the server opens the stage. One draft order,
 * made once, from the state alone.
 */
export function onStageEntered(state: LeagueState, from?: string): void {
  if (state.stage === "fantasyDraft" && state.draft?.mode !== "fantasy") {
    beginDraft(state, "fantasy");
  }
  if (state.stage === "offseasonDraft" && state.draft?.mode !== "rookie") {
    beginDraft(state, "rookie");
  }
  // whoever opens the board, the league plays its own teams up to the first
  // pick a person actually owes
  runAiPicks(state);

  // The rest mirrors the single-player `tryAdvance`, which does this work in
  // the same order. Online it was simply absent: the server set a stage field
  // and nothing else, so a league left the draft with twenty-man rosters and
  // reached the preseason unable to field a legal lineup.
  if (from === "fantasyDraft" && state.stage === "fantasyDraftSummary") {
    openStandingMarketFromUndrafted(state);
    fillRosterGaps(state);
  }
  if (from === "offseasonSignings" && state.stage === "offseasonFreeAgency") {
    signAiDraftPicks(state);
    trimRosters(state);
  }
  if (from === "offseasonRetirement" && state.stage === "offseasonDraftPrep") {
    commitRetirements(state);
  }
  // nobody takes the field short — free agency is optional, so a team can
  // arrive here still missing a position entirely
  if (state.stage === "preseason") fillRosterGaps(state);

  recomputeTeamRatings(state);
}

/**
 * Online, nobody is "the viewer", so everyone starts a stage not-ready.
 *
 * The single-player version marks every GM but the one at the keyboard ready,
 * which is right for a hot seat and wrong here — it would advance a league of
 * eight the instant one person clicked.
 */
export function clearReadinessOnline(state: LeagueState): void {
  for (const g of state.gms) state.readiness[g.id] = false;
  // an AI-run team is always ready; there's nobody to wait for
  for (const g of state.gms) if (!g.isHuman || !g.teamCode) state.readiness[g.id] = true;
}

/**
 * Takes the turn of whoever didn't show, then advances.
 *
 * What "taking their turn" means depends on the stage. In a draft it's the
 * pick the AI would have made. Everywhere else it's simply marking them
 * ready: the stage's own automation (the roster fill, the bidding resolver)
 * already covers a team that did nothing, because that's exactly what an
 * AI-controlled team does all season.
 */
export function autopilotAbsent(state: LeagueState): string[] {
  const absent = state.gms.filter((g) => g.isHuman && g.teamCode && !state.readiness[g.id]);
  const played: string[] = [];

  const draft = state.draft;
  if (draft && (state.stage === "fantasyDraft" || state.stage === "offseasonDraft")) {
    // only the team actually on the clock is holding anyone up
    const onTheClock = draft.pickOrder[draft.currentPickIndex];
    const gm = state.gms.find((g) => g.teamCode === onTheClock);
    if (onTheClock && gm?.isHuman) {
      const pick = planAutopicks(state)[0];
      if (pick) {
        applyPick(state, pick);
        played.push(onTheClock);
      }
    }
    // and then the league's own teams, so the clock lands on a person again
    played.push(...runAiPicks(state));
    return played;
  }

  for (const g of absent) {
    state.readiness[g.id] = true;
    played.push(g.teamCode);
  }
  return played;
}

/** Leagues whose current phase has run out of time. */
export async function expiredLeagues(): Promise<string[]> {
  const rows = await pool.query<{ league_id: string }>(
    `SELECT league_id FROM league_state
      WHERE phase_ends_at IS NOT NULL AND phase_ends_at <= now()`,
  );
  return rows.rows.map((r) => r.league_id);
}

/**
 * One pass over every league whose deadline has passed.
 *
 * Safe to run concurrently with player actions and with itself: each league
 * is handled inside the same locked transaction an action would use, and the
 * deadline is rewritten as part of that transaction, so a second sweeper
 * arriving a millisecond later finds nothing to do.
 */
export async function sweep(): Promise<{ leagueId: string; autopiloted: string[] }[]> {
  const out: { leagueId: string; autopiloted: string[] }[] = [];
  for (const leagueId of await expiredLeagues()) {
    try {
      const { result } = await withLeague(leagueId, async ({ state, league }) => {
        const autopiloted = autopilotAbsent(state);
        // a deadline may not start a league that nobody has finished joining
        const moved = humanGate(state) && rosterGate(state) ? advanceStage(state).moved : false;
        return {
          result: { autopiloted, moved },
          state,
          // whether or not the stage moved, the clock restarts: a draft that
          // autopicked has a new team on the clock and its own fresh window
          phaseEndsAt: deadlineFor(state, league),
          events: autopiloted.map((teamCode) => ({
            teamCode,
            kind: "phase.autopiloted",
            summary: `${teamCode} ran out of time; their staff acted for them.`,
          })),
        } satisfies { result: { autopiloted: string[]; moved: boolean } } & Applied;
      });
      out.push({ leagueId, autopiloted: result.autopiloted });
    } catch (err) {
      // one bad league must not stop the sweep for the rest
      // eslint-disable-next-line no-console
      console.error(`sweep failed for league ${leagueId}`, err);
    }
  }
  return out;
}

/** Commissioner override: move on now, whoever is or isn't ready. */
export async function forceAdvance(leagueId: string): Promise<AdvanceOutcome> {
  const { result } = await withLeague(leagueId, async ({ state, league }) => {
    const autopiloted = autopilotAbsent(state);
    const outcome = advanceStage(state);
    if (!outcome.moved && !autopiloted.length) {
      throw new ActionError("There's nothing to advance past right now.");
    }
    return {
      result: { moved: outcome.moved, stage: state.stage, autopiloted },
      state,
      phaseEndsAt: deadlineFor(state, league),
      events: [
        {
          kind: "phase.forced",
          summary: `The commissioner moved the league on to ${state.stage}.`,
        },
      ],
    } satisfies { result: AdvanceOutcome } & Applied;
  });
  return result;
}

/** How long is left, for the client to show a countdown. */
export function timeLeft(loaded: LoadedLeague): number | null {
  if (!loaded.phaseEndsAt) return null;
  return Math.max(0, loaded.phaseEndsAt.getTime() - Date.now());
}
