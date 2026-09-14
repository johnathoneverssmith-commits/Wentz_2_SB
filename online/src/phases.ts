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
  clearReadiness,
  humanGate,
  isInSeason,
  openSlots,
  planAutopicks,
  rosterGate,
  applyPick,
} from "@/state/rules.ts";

import { ActionError, pool, withLeague, type Applied, type LoadedLeague } from "./db.js";

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
  const t = resolveTransition(state, {});
  state.stage = t.stage;
  state.week = t.week;
  clearReadinessOnline(state);
  return { moved: true, autopiloted: [] };
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
