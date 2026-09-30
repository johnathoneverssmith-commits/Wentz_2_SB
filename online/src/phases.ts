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
import { checkTrade } from "@/state/rules.ts";
import { generateAiTradeOffers } from "@/state/aiTrades.ts";
import type { LeagueState } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import { formHumansOnlyLeague, humansOnlySchedule, isHumansOnly, seasonShape } from "@/state/leagueFormat.ts";
import { resolveTransition, STAGE_LABEL } from "@/state/stageMachine.ts";
import { beginTradeDeadline, runCpuTurns as runDeadlineTurns } from "@/state/tradeDeadline.ts";
import { currentBlock } from "@/state/revealBlocks.ts";
import { emptyReveal } from "@/state/reveal.ts";

import { runOrDefer } from "./blockJobs.js";
import { wipePreseason } from "@/state/preseasonWipe.ts";
import {
  advanceBiddingDayOn,
  beginDraft,
  clearReadiness,
  commitRetirements,
  humanGate,
  finishDraftBoard,
  isInSeason,
  openSlots,
  openStandingMarketFromUndrafted,
  planAutopicks,
  rosterGate,
  runAiPicks,
  sbWonByHuman,
  finalizeSeason,
  signAiDraftPicks,
  signUndraftedAsFreeAgents,
  applyPick,
} from "@/state/rules.ts";
import { campCuts, fillRosterGaps, fitDraftedPayrolls, leagueSalt, recomputeTeamRatings, trimRosters } from "@/state/seed.ts";

import { beginCoachingDraft, coachingOnTheClock, runAiCoachingPicks, suggestedCoachingPick } from "@/state/coachingDraft.ts";
import { onTheClock as faOnTheClock } from "@/state/freeAgencyEvent.ts";
import { pendingFor } from "@/state/tradeDeadline.ts";
import { decideCoachingPick, decideDeadlineTurn, decideFreeAgencyTurn, runPendingCpuTurns } from "./decide.js";
import { beginFreeAgencyEvent, runCpuTurns } from "@/state/freeAgencyEvent.ts";
import { reconcileCpuTeam } from "@/state/reconciliation.ts";
import { openTrainingCamp } from "@/state/trainingCamp.ts";
import { clearInjuries, healOneWeek } from "@/state/injuries.ts";
import { ensureHoodedFigureEncounters, hoodedFigureEncounterFor } from "@/state/hoodedFigure.ts";
import { ensureDraftPicks, forgetSpentPicks } from "@/state/draftPicks.ts";
import { applySeasonAging, forgetOldRetirees, pruneFreeAgentMarket } from "@/state/seed.ts";
import { resetSeasonStats } from "@/state/standings.ts";
import { draftClassTilt } from "@/state/draftSupply.ts";
import { compactRetired } from "@/state/saveCompaction.ts";
import { MockSimulationService } from "@/sim/MockSimulationService";

import { ActionError, pool, withLeague, type Applied, type LoadedLeague } from "./db.js";
import { noteEvent } from "./notes.js";

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
  const hours = isTurnStage(state.stage) ? league.pickTimeoutHours : league.phaseTimeoutHours;
  return new Date(Date.now() + hours * 3_600_000);
}

/** Stages played one turn at a time, where the clock is a per-turn clock. */
export function isTurnStage(stage: string): boolean {
  return (
    stage === "fantasyDraft" ||
    stage === "offseasonDraft" ||
    stage === "coachingDraft" ||
    stage === "freeAgency" ||
    stage === "midseasonFreeAgency" ||
    stage === "tradeDeadline"
  );
}

/**
 * Whose turn it is, as a key that changes every time the turn does — so the
 * per-turn clock can restart for the next GM rather than running on from
 * the last one's.
 */
export function turnKey(state: LeagueState): string {
  const d = state.draft;
  const fa = state.freeAgencyEvent;
  const td = state.tradeDeadline;
  return [
    state.stage,
    d ? d.currentPickIndex : "",
    state.coachingDraft ? state.coachingDraft.currentPickIndex : "",
    fa ? `${fa.round}.${fa.turnIndex}` : "",
    td ? `${td.round}.${td.index}.${td.active?.id ?? ""}.${td.active?.awaiting ?? ""}` : "",
  ].join("|");
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
  /** The stage the GM was looking at when they pressed. */
  seenStage?: string,
): Promise<AdvanceOutcome> {
  const { result } = await withLeague(leagueId, async ({ state, league }) => {
    // A ready is for the stage on the GM's screen. When the league has
    // already left it (their click raced the last GM's), applying it to the
    // new stage committed them to something they had not seen — twice in a
    // playthrough that skipped a whole free-agency market. Leave the new
    // stage untouched and let the client catch up.
    if (seenStage && seenStage !== state.stage) {
      return {
        result: { moved: false, stage: state.stage, autopiloted: [] as string[] },
        state,
        unchanged: true,
      } satisfies { result: AdvanceOutcome } & Applied;
    }
    const already = (state.readiness[gmId] ?? false) === ready;
    state.readiness[gmId] = ready;
    // `rosterGate` is what stops one GM starting a league by themselves while
    // the other seats are still empty — see its note in `rules.ts`.
    const gateOpen = ready && humanGate(state) && rosterGate(state);
    const outcome = gateOpen ? advanceOrTurnDay(state) : { moved: false, autopiloted: [] as string[] };
    // Online, each GM already sees their camp results as a step inside
    // training camp, and the only check-in there is on that results screen —
    // so the league-wide results stage that follows asked every GM to press
    // the same button on the same screen a second time. When everyone checked
    // in to get here, they have all seen it: carry on. (A commissioner's
    // force-advance doesn't come through here and still stops for it.)
    if (outcome.moved && state.stage === "trainingCampResults") advanceStage(state);
    return {
      result: { moved: outcome.moved, stage: state.stage, autopiloted: outcome.autopiloted },
      state,
      // a repeated press that opened nothing
      unchanged: already && !gateOpen,
      phaseEndsAt: outcome.moved ? deadlineFor(state, league) : undefined,
      events: outcome.moved
        ? [{ kind: "phase.advanced", summary: `The league moved on to ${stageName(state.stage)}.` }]
        : [],
    } satisfies { result: AdvanceOutcome } & Applied;
  });
  return result;
}

/**
 * The transition a readiness gate should apply, or null when there isn't one.
 *
 * In-season stages used to be excluded outright, because a week advanced by
 * being played rather than by anyone pressing a button. Changes 6 through 11
 * changed that: a block is played at a checkpoint and then *revealed*, so the
 * only thing that ends the preseason, either half of the regular season, or
 * the postseason is every human GM committing — and with the old exclusion
 * that press did nothing at all. A league reaching the end of its preseason
 * simply stopped.
 *
 * The week is not the test any more either. Reveals do not move `state.week`,
 * so a preseason that has been watched to the end still reads week 1. What
 * says a block is over is the block itself, so the transition is resolved
 * against the block's last week rather than against the league's.
 */
function inSeasonTransition(state: LeagueState) {
  const opts = { humanGmWonSuperBowl: sbWonByHuman(state) };
  if (!isInSeason(state.stage)) return resolveTransition(state, opts);

  const block = currentBlock(state);
  if (state.stage === "playoffs") {
    // the postseason ends when it has been played, which after Change 11 is
    // true the moment the stage opens — the readiness gate is what releases
    // the GMs, not what decides the games
    const t = resolveTransition(state, opts);
    return t.stage === state.stage ? null : t;
  }
  if (!block) return null;
  const t = resolveTransition({ ...state, week: block.lastWeek }, opts);
  return t.stage === state.stage ? null : t;
}

/**
 * Inside a sealed-bid window, "everyone is ready" means the day resolves —
 * not that the stage is over.
 *
 * Single-player the day turns on a twelve-minute countdown in the browser.
 * That cannot be the rule online: every client runs its own clock, and the
 * first one to reach zero would resolve a day the others were still bidding
 * in, against its own copy of the league. So the day turns when every GM says
 * they are done with it, or when the phase deadline runs out — the same two
 * things that move everything else in an asynchronous league.
 */
function advanceOrTurnDay(state: LeagueState): { moved: boolean; autopiloted: string[] } {
  const subject =
    state.stage === "coachingHiring"
      ? ("coaches" as const)
      : state.stage === "offseasonFreeAgency"
        ? ("players" as const)
        : null;
  const fa = subject ? state[subject === "coaches" ? "coachingHire" : "freeAgency"] : null;
  if (subject && fa && fa.mode === "main") {
    advanceBiddingDayOn(state, subject);
    // a new day needs everybody's attention again
    clearReadinessOnline(state);
    return { moved: false, autopiloted: [] };
  }
  return advanceStage(state);
}

/**
 * What `readyUp` decides, without a database — the seam the tests use.
 * Returns whether the *stage* moved (a bidding day turning is not that).
 */
export function readyUpLocal(state: LeagueState): boolean {
  if (!humanGate(state) || !rosterGate(state)) return false;
  const before = state.stage;
  advanceOrTurnDay(state);
  return state.stage !== before;
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
  const from = state.stage;
  const t = inSeasonTransition(state);
  if (!t) return { moved: false, autopiloted: [] };
  // a draft leaves with its board full — a threshold met on an autopick, or
  // a commissioner pushing the league on, drafts the rest first
  finishDraftBoard(state);
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
  // the deadline only opens when there isn't one — keep last year's and no
  // season after the first ever has a deadline or a midseason market
  state.tradeDeadline = null;
  state.games = [];
  state.draft = null;
  state.draftTargets = {};
  state.freeAgency = null;
  state.coachingHire = null;
  state.trades = [];
  state.rookieOutcomes = {};
  state.pendingGameDay = null;
  forgetSpentPicks(state, state.season); // that draft has happened
  ensureDraftPicks(state, state.season); // and two more are now tradeable
  clearInjuries(state); // an offseason outlasts any injury
  pruneFreeAgentMarket(state); // careers that stopped going anywhere end
  compactRetired(state);
  forgetOldRetirees(state); // and a save shouldn't carry them forever
  applySeasonAging(state, state.season);
  reportStaffMoves(state, "for the new season", () => fillRosterGaps(state));
  state.draftClass = sim.generateDraftClass(state.season + leagueSalt(state), state.season, draftClassTilt(state));
  for (const code of Object.keys(state.teams)) {
    const team = state.teams[code]!;
    team.wins = team.losses = team.ties = 0;
    team.pointsFor = team.pointsAgainst = 0;
    team.playoffSeed = 0;
  }
  // a humans-only league plays its own round robin, reshuffled each season
  state.schedule = isHumansOnly(state)
    ? humansOnlySchedule(state)
    : sim.generateSchedule(state.season, Object.keys(state.teams));
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
  const from = state.stage;
  state.stage = t.stage;
  state.week = t.week;
  // `pendingGameDay` is deliberately left alone. It is what the Game Day
  // screen renders, and clearing it here meant the server played a week and
  // then immediately threw away the only record that there was anything to
  // watch — online you got new scores in the standings and never saw a game.
  // Single-player clears it when the player hits continue; online each GM
  // reads it in their own time, so it stands until the next week replaces it.
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
/** Teams a person is running, for anything that must stop and ask. */
function humanTeamsOf(state: LeagueState): Set<string> {
  return new Set(state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
}

export function onStageEntered(state: LeagueState, from?: string): void {
  // leaving setup in a humans-only league: the league becomes the claimed
  // teams plus the fewest CPU teams that make it even (and at least four),
  // before the draft builds anyone's roster — the same step the local store
  // takes in `applyStageEntry`
  if (from === "setup" && isHumansOnly(state)) formHumansOnlyLeague(state);

  if (state.stage === "fantasyDraft" && state.draft?.mode !== "fantasy") {
    beginDraft(state, "fantasy");
  }
  if (state.stage === "offseasonDraft" && state.draft?.mode !== "rookie") {
    beginDraft(state, "rookie");
  }
  // whoever opens the board, the league plays its own teams up to the first
  // pick a person actually owes
  runAiPicks(state);

  // The timed sealed-bid windows are gone: signing is asynchronous and lives
  // on the hub, so there is no window to open here.

  // Change 3: the coaching draft opens with the stage, the same way the player
  // draft does — the board is league state and belongs to the server, not to
  // whichever client happened to load the screen first.
  if (state.stage === "coachingDraft") {
    beginCoachingDraft(state);
    runAiCoachingPicks(state, humanTeamsOf(state));
  }

  // Change 4: the market opens with the stage, and the CPU teams ahead of the
  // first human take their turns straight away.
  if (state.stage === "freeAgency" && from !== "freeAgency") {
    // Change 13: the saved event is midseason's by now, so it is cleared for
    // the same reason midseason cleared the offseason's — this is a different
    // five rounds, with an order recalculated from post-draft roster strength
    // and a pool that no longer contains the rookies who just signed.
    state.freeAgencyEvent = null;
    beginFreeAgencyEvent(state);
    runCpuTurns(state, humanTeamsOf(state));
  }

  // Change 9: the same market again, halfway through the season. The old
  // event is cleared first rather than resumed — it is a different five
  // rounds with a different order and a different pool, and reusing the
  // saved one would reopen the offseason's offers.
  if (state.stage === "midseasonFreeAgency" && from !== "midseasonFreeAgency") {
    state.freeAgencyEvent = null;
    beginFreeAgencyEvent(state);
    runCpuTurns(state, humanTeamsOf(state));
  }

  // Change 4: the cap and the roster limits come back here. The CPU teams
  // sort themselves out on the way in, so a human arriving at the summary is
  // the only one with anything left to fix — and the league is never carrying
  // thirty-one illegal rosters while one person reads their signings.
  // Change 5: the CPU teams run their camps as the stage opens, so a human
  // arriving at the depth chart is the only one with anything outstanding.
  if (state.stage === "trainingCamp") {
    // a fresh camp each season — it used to open once ever, so from year two
    // every team read as having already trained
    openTrainingCamp(state, humanTeamsOf(state));
  }

  // The catch-up mechanic's offer: CPU teams never receive it (§3), so there
  // is nothing to sweep here — just generate the encounter for whichever
  // human GMs are eligible, once, the moment the stage opens.
  // The league goes shopping at the two moments it would: the day the season
  // ends and the preseason depth chart — the same offers a single-player GM
  // gets (store.ts). Online never generated them, so an online GM's phone
  // only ever rang at the trade deadline.
  if ((state.stage === "offseasonRetirement" || state.stage === "offseasonDepthChart") && from !== state.stage) {
    const fresh = generateAiTradeOffers(state, state.stage === "offseasonRetirement" ? 1 : 2, 1);
    for (const offer of fresh) {
      if (!checkTrade(state, offer).ok) continue;
      if (!state.trades.some((x) => x.id === offer.id)) state.trades.push(offer);
    }
  }

  // (idempotent; on the depth chart too, for the seasons the encounter stage
  // is skipped — it is also where last season's bargains end)
  if (state.stage === "hoodedFigureEncounter" || state.stage === "offseasonDepthChart") {
    ensureHoodedFigureEncounters(state);
  }

  if (state.stage === "freeAgencySummary" && state.rosterFillPending) {
    reportStaffMoves(state, "after free agency", () => fillRosterGaps(state));
    state.rosterFillPending = false;
  }
  if (state.stage === "freeAgencySummary" || state.stage === "midseasonFreeAgencySummary") {
    const humans = humanTeamsOf(state);
    for (const teamCode of Object.keys(state.teams)) {
      if (humans.has(teamCode)) continue;
      reconcileCpuTeam(state, teamCode);
    }
  }

  // The rest mirrors the single-player `tryAdvance`, which does this work in
  // the same order. Online it was simply absent: the server set a stage field
  // and nothing else, so a league left the draft with twenty-man rosters and
  // reached the preseason unable to field a legal lineup.
  // every undrafted player opens year-one free agency; the fill waits for
  // that market to close (same as the store)
  if (from === "fantasyDraft" && state.stage === "fantasyDraftSummary") {
    openStandingMarketFromUndrafted(state);
    fitDraftedPayrolls(state);
    state.rosterFillPending = true;
  }
  // the draft summary now leads straight into free agency (Change 13): the
  // CPU classes are signed and the undrafted go to the market here, or they
  // never are — the branch below hangs off a stage the league no longer enters
  // this season's draft is over: its picks are spent (see the store)
  if (from === "offseasonDraft") forgetSpentPicks(state, state.season + 1);

  if (from === "offseasonDraftSummary" && state.stage === "freeAgency") {
    signAiDraftPicks(state);
    signUndraftedAsFreeAgents(state);
  }
  // see the same note in the store: the free-agency stage is gone, so the AI's
  // draft-class signings and the roster trim hang off the depth-chart gate
  if (from === "offseasonSignings" && state.stage === "offseasonDepthChart") {
    signAiDraftPicks(state);
    reportStaffMoves(state, "for the depth chart", () => trimRosters(state));
  }
  // Change 12: retirements are applied and the draft class is built on the
  // way *into* the offseason rather than on the way out of the retirement
  // screen. The review is a review — it shows what already happened — and
  // every GM has to be shown the same set, which cannot be true if it is
  // computed when the first one leaves the screen.
  if (state.stage === "offseasonRetirement" && from !== "offseasonRetirement") {
    commitRetirements(state);
    state.draftClass ??= sim.generateDraftClass(state.season + 1 + leagueSalt(state), state.season, draftClassTilt(state));
  }
  // nobody takes the field short — free agency is optional, so a team can
  // arrive here still missing a position entirely
  if (state.stage === "preseason" && from !== "preseason") campCuts(state);
  if (state.stage === "preseason") {
    reportStaffMoves(state, "before the preseason", () => fillRosterGaps(state, { lateMarket: true }));
  }

  // Change 6: the whole preseason is played here, once, before anybody sees
  // it. Everything afterwards is a reveal of what this produced — which is
  // what lets four GMs watch the same three weeks at four different speeds
  // without any of them changing the result.
  if (state.stage === "preseason" && from !== "preseason") {
    const alreadyPlayed = state.games.some((g) => g.phase === "PRE" && g.played);
    if (!alreadyPlayed) {
      runOrDefer(state, { kind: "block", phase: "PRE", from: 1, to: seasonShape(state).preseasonWeeks });
      state.reveal = emptyReveal();
    }
  }

  // Change 6: the preseason is deleted on the way into the regular season,
  // once, after every GM has committed — which is exactly here, since this
  // only runs when the stage actually moved. Change 7: weeks 1-9 are then
  // precomputed the same way the preseason was, and week 10 deliberately is
  // not; the trade deadline sits between them and has to be able to change
  // what happens after it.
  // The hooded-figure mechanic's League Developments screen now sits between
  // preseason and the regular season (it has to be shown only after preseason
  // is simulated), so `from` is "leagueDevelopments" here, not "preseason" —
  // both have to trigger this, since a league with nobody eligible for an
  // encounter still passes straight through that stage in one plain click.
  if (state.stage === "regularSeason" && (from === "preseason" || from === "leagueDevelopments")) {
    wipePreseason(state);
    const alreadyPlayed = state.games.some((g) => g.phase === "REG" && g.played);
    if (!alreadyPlayed) runOrDefer(state, { kind: "block", phase: "REG", from: 1, to: seasonShape(state).deadlineWeek });
  }

  // Change 8: the deadline builds its order from the week 1-9 standings and
  // then runs itself forward until a human is on the clock. Every CPU turn in
  // the league can resolve before anyone sees the screen, which is the point
  // — a GM opens it and it is their move or it is over.
  if (state.stage === "tradeDeadline" && from !== "tradeDeadline") {
    beginTradeDeadline(state);
    runDeadlineTurns(state);
  }

  // Change 7's second block: weeks 10 through 18, precomputed with the
  // rosters the deadline left behind.
  if (state.stage === "regularSeason" && from === "midseasonDepthChart") {
    const alreadyPlayed = state.games.some(
      (g) => g.phase === "REG" && g.played && g.week > seasonShape(state).deadlineWeek,
    );
    if (!alreadyPlayed) {
      runOrDefer(state, {
        kind: "block",
        phase: "REG",
        from: seasonShape(state).deadlineWeek + 1,
        to: seasonShape(state).regularSeasonWeeks,
      });
    }
  }

  // The season is scored the moment the playoffs end, so the end-of-season
  // screens, the score tracker and next year's roasts all have this year's
  // row to read.
  //
  // It lives here rather than beside the transition because there are two
  // ways into this stage now — a played week and a readiness gate — and it
  // was only wired to the first. A league that revealed its way to the Super
  // Bowl reached the end-of-season screens with no season on the books.
  // `finalizeSeason` already refuses to write the same year twice, so being
  // called from the shared path is free.
  if (state.stage === "endOfSeasonAnnounce") {
    finalizeSeason(state);
    // Online the announcement is the awards splash each GM sees on the way
    // to the season screen, not a gate of its own: as a stage it made every
    // GM ready up twice on the same /season-complete page ("Continue", then
    // "Ready to advance to the offseason"). Pass straight through.
    const t = resolveTransition(state, { humanGmWonSuperBowl: sbWonByHuman(state) });
    state.stage = t.stage;
    state.week = t.week;
  }

  // Change 11: the whole postseason is decided here, in one pass, for the
  // same reason the regular season is — except that a bracket has no partial
  // state worth saving. The divisional round does not exist until the wild
  // card is settled, so it is all four rounds or none.
  if (state.stage === "playoffs" && from !== "playoffs") {
    // seeding is a pure reading of the completed standings, so the server
    // does it here rather than waiting for a screen to ask
    state.bracket ??= sim.seedBracket(state);
    runOrDefer(state, { kind: "playoffs" });
  }

  recomputeTeamRatings(state);
}

/**
 * The roster fill and trim run on every team, a GM's included — they are what
 * stops anyone taking the field short or over 53. They used to do it
 * silently: a GM left free agency at 45 players and found 53 at the
 * preseason, eight of them strangers, with nothing anywhere saying who or
 * why. Now each human team gets a line on the wire naming them.
 */
function reportStaffMoves(state: LeagueState, when: string, run: () => void): void {
  const humans = state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode!);
  const before = new Map(humans.map((t) => [t, rosterIds(state, t)]));
  run();
  for (const team of humans) {
    const was = before.get(team)!;
    const now = rosterIds(state, team);
    const added = [...now].filter((id) => !was.has(id)).map((id) => state.players[id]!);
    const cut = [...was].filter((id) => !now.has(id)).map((id) => state.players[id]);
    if (added.length === 0 && cut.length === 0) continue;
    const name = TEAMS_BY_CODE[team]?.label ?? team;
    const list = (ps: ({ name: string; position: string } | undefined)[]) => {
      const named = ps.filter((p): p is { name: string; position: string } => !!p);
      const shown = named.slice(0, 5).map((p) => `${p.name} (${p.position})`);
      return named.length > 5 ? `${shown.join(", ")} and ${named.length - 5} more` : shown.join(", ");
    };
    const parts = [
      added.length ? `signed ${list(added)}` : "",
      cut.length ? `released ${cut.length <= 3 && cut.every(Boolean) ? list(cut) : `${cut.length} players`}` : "",
    ].filter(Boolean);
    noteEvent(state, {
      teamCode: team,
      kind: "roster.staff",
      summary: `${name}'s staff ${parts.join(" and ")} ${when}.`,
    });
  }
}

function rosterIds(state: LeagueState, team: string): Set<string> {
  return new Set(
    Object.values(state.players)
      .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent)
      .map((p) => p.id),
  );
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
  // The Hooded Figure visits one losing franchise; every other GM was shown
  // "Nothing unusual this year" and still had to check in before the league
  // could reach the depth chart. They have nothing to decide, so they start
  // checked in and the league waits only on the GM with the visitor.
  if (state.stage === "hoodedFigureEncounter") {
    for (const g of state.gms) {
      if (g.isHuman && g.teamCode && !hoodedFigureEncounterFor(state, g.teamCode)) state.readiness[g.id] = true;
    }
  }
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
  // Change 2: a checkpoint has no clock. Marking an absent GM ready is exactly
  // the thing committing was supposed to rule out — the league moving without
  // you — so the deadline no longer stands in for anybody at a stage gate.
  // The consequence is deliberate and recorded in the change log: a GM who
  // never returns ends that league. Only the draft, where a turn genuinely
  // blocks a queue, still plays for someone who is not there.
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

  // The other turn-based events queue the same way the draft does: one GM
  // who went quiet on the clock held every other GM in the coaching draft,
  // the market or the deadline until the commissioner forced the whole stage
  // past — skipping everyone's turns. So an expired clock takes *that* GM's
  // turn the plain way (best-value coach, pass, decline), through the same
  // decisions their own click would run. Stage check-ins still wait.
  // a refused move is logged and skipped rather than failing the sweep's
  // transaction, which would retry — and fail — every minute
  const tryTurn = (take: () => unknown): boolean => {
    try {
      take();
      return true;
    } catch (err) {
      console.error("autopilot turn refused", err);
      return false;
    }
  };
  const actorFor = (teamCode: string) => {
    const gm = state.gms.find((g) => g.isHuman && g.teamCode === teamCode);
    return gm ? { userId: "", leagueId: "", teamCode, gmId: gm.id } : null;
  };
  // a CPU team on the clock (a seat reopened mid-event) — nothing else prompts it
  const onClock =
    state.stage === "coachingDraft"
      ? coachingOnTheClock(state)
      : state.stage === "freeAgency" || state.stage === "midseasonFreeAgency"
        ? faOnTheClock(state)
        : null;
  if (onClock && !actorFor(onClock)) {
    runPendingCpuTurns(state);
    return played;
  }
  if (state.stage === "coachingDraft") {
    const on = coachingOnTheClock(state);
    const actor = on ? actorFor(on) : null;
    const pick = actor ? suggestedCoachingPick(state, actor.teamCode) : null;
    if (actor && pick && tryTurn(() => decideCoachingPick(state, actor, pick.id))) played.push(actor.teamCode);
    return played;
  }
  if ((state.stage === "freeAgency" || state.stage === "midseasonFreeAgency") && state.freeAgencyEvent && !state.freeAgencyEvent.complete) {
    const on = faOnTheClock(state);
    const actor = on ? actorFor(on) : null;
    if (actor && tryTurn(() => decideFreeAgencyTurn(state, actor, { pass: true }))) played.push(actor.teamCode);
    return played;
  }
  if (state.stage === "tradeDeadline" && state.tradeDeadline && !state.tradeDeadline.done) {
    for (const gm of state.gms) {
      if (!gm.isHuman || !gm.teamCode) continue;
      const duty = pendingFor(state, gm.teamCode);
      if (!duty) continue;
      const move = duty === "propose" ? ({ kind: "skip" } as const) : ({ kind: "deny" } as const);
      if (tryTurn(() => decideDeadlineTurn(state, actorFor(gm.teamCode)!, move))) played.push(gm.teamCode);
      break;
    }
    return played;
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
        const moved =
          humanGate(state) && rosterGate(state) ? advanceOrTurnDay(state).moved : false;
        return {
          result: { autopiloted, moved, inSeason: isInSeason(state.stage) },
          state,
          // whether or not the stage moved, the clock restarts: a draft that
          // autopicked has a new team on the clock and its own fresh window
          phaseEndsAt: deadlineFor(state, league),
          events: autopiloted.map((teamCode) => ({
            teamCode,
            kind: "phase.autopiloted",
            summary: `${TEAMS_BY_CODE[teamCode]?.label ?? teamCode} ran out of time; their staff acted for them.`,
          })),
        } satisfies {
          result: { autopiloted: string[]; moved: boolean; inSeason: boolean };
        } & Applied;
      });
      out.push({ leagueId, autopiloted: result.autopiloted });

      // A game week has no stage gate to open — it advances by being played.
      // The autopilot above marked the absent GMs ready, so if the league is
      // in season and now unblocked, the week itself is what the deadline was
      // waiting on. Deliberately outside the transaction above: this takes
      // the league's lock itself, and refuses when the week is already on
      // file, so it is safe to reach here twice.
      if (result.inSeason) {
        const { simulateWeekForLeague } = await import("./simulate.js");
        await simulateWeekForLeague(leagueId).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`sweep could not play the week for ${leagueId}`, err);
          return null;
        });
      }
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
          summary: `The commissioner moved the league on to ${stageName(state.stage)}.`,
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

/** A stage as the screens name it, for feed text. */
export function stageName(stage: string): string {
  return (STAGE_LABEL as Record<string, string>)[stage] ?? stage;
}
