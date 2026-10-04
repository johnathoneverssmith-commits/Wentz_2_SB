/**
 * What each action *decides*, with no database in sight.
 *
 * Every one of these takes the league as it currently is, plus who is asking
 * and what they want, and returns the league as it should become — or throws
 * with a sentence explaining why not. None of them read or write anything.
 *
 * The split is worth the extra file. The interesting part of a multiplayer
 * action is the ruling ("you can't, you're $4M short"), and the boring part
 * is the transaction around it. Keeping the ruling pure means it can be
 * tested exhaustively without a Postgres, which matters because the rulings
 * are where the bugs that lose a league actually live — a trade that
 * shouldn't have gone through is unrecoverable in a way a dropped connection
 * isn't.
 *
 * `actions.ts` wraps each of these in `withLeague`, which supplies the row
 * lock, the version check and the event log.
 */
import { setSkip } from "@/state/skips.ts";
import { bracketRounds, COACH_ROLE_LABEL, ROUND_ORDER, roundLabelFor } from "@/domain";
import type { ContractOffer, LeagueState, Position, TradeAsset } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import {
  applyPick,
  applyTrade,
  checkBid,
  checkStandingSign,
  checkCoachHire,
  checkRookieOutcome,
  completeDraft,
  toggleDraftTargetFor,
  draftThresholdMet,
  applyRookieOutcome,
  applyCoachHire,
  checkTrade,
  offerToContract,
  runAiPicks,
  type Subject,
} from "@/state/rules.ts";
import { exerciseFifthYearOption, extendContract, franchiseTag, restructureContract } from "@/state/contracts.ts";
import { practiceSquadTeam, promoteFromPracticeSquad, toPracticeSquad } from "@/state/practiceSquad.ts";
import {
  applyOffer,
  applyPass,
  checkOffer,
  onTheClock,
  runCpuTurns,
} from "@/state/freeAgencyEvent.ts";
import {
  applyCoachingPick,
  checkCoachingPick,
  coachingDraftComplete,
  runAiCoachingPicks,
} from "@/state/coachingDraft.ts";
import {
  checkCampSubmission,
  runTrainingCamp,
  type TrainingCampPlan,
} from "@/state/trainingCamp.ts";
import {
  checkHoodedFigurePayment,
  hoodedFigureEncounterFor,
  resolveHoodedFigureEncounter,
} from "@/state/hoodedFigure.ts";
import {
  markRevealed,
  markRoundRevealed,
  markStep,
  revealedRounds,
  revealedWeek,
} from "@/state/reveal.ts";
import { resolveTransition } from "@/state/stageMachine.ts";
import {
  proposeAtDeadline,
  respondAtDeadline,
  runCpuTurns as runDeadlineTurns,
  skipTurn,
} from "@/state/tradeDeadline.ts";

import { clearReadinessOnline, onStageEntered } from "./phases.js";
import { applyRelease, checkRelease, reconcileCpuTeam, reconciliationIssues } from "@/state/reconciliation.ts";
import { PAST_DEADLINE_MESSAGE, pastTradeDeadline } from "@/state/tradeDeadline.ts";
import { recomputeTeamRatings, releaseToMarket } from "@/state/seed.ts";

import { ActionError } from "./db.js";
import { MockSimulationService } from "@/sim/MockSimulationService";
import { posLabel } from "@/util/format";

const tradeJudge = new MockSimulationService();

/** Who is asking. Resolved from the database, never from the request body. */
export interface Actor {
  userId: string;
  leagueId: string;
  teamCode: string;
  gmId: string;
}

export interface Decision {
  events: { teamCode?: string | undefined; kind: string; summary: string; detail?: unknown }[];
  /** Nothing changed: roll back rather than bump the version and send every GM to re-download. */
  unchanged?: boolean | undefined;
}

const city = (code: string): string => TEAMS_BY_CODE[code]?.label ?? code;

/**
 * Sign a standing free agent.
 *
 * The check runs against the state handed in, which the caller has just read
 * under a lock — so "he's still available" and "you still have the money"
 * are answered as of now, not as of whenever the client last refreshed.
 */
export function decideSignFreeAgent(
  state: LeagueState,
  actor: Actor,
  playerId: string,
  offer: Omit<ContractOffer, "teamCode">,
): Decision {
  // a signing mid-block reads as help for next week — which is already played
  refuseDuringBlock(state, "Signing free agents");
  const full: ContractOffer = { ...offer, teamCode: actor.teamCode };
  const check = checkStandingSign(state, playerId, full);
  if (!check.ok) throw new ActionError(check.reason ?? "That signing isn't allowed.");

  const p = state.players[playerId];
  if (!p) throw new ActionError("No such player.", 404);
  p.free_agent = false;
  p.nfl_team = actor.teamCode;
  p.contract = offerToContract(full);
  state.standingFreeAgents = state.standingFreeAgents.filter((x) => x !== playerId);
  recomputeTeamRatings(state);

  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "fa.signed",
        summary: `${city(actor.teamCode)} signed ${p.name} (${posLabel(p.position)}) for $${offer.baseSalary.toFixed(1)}M a year.`,
        detail: { playerId },
      },
    ],
  };
}

/** Place or replace a bid in the live window. */
export function decidePlaceBid(
  state: LeagueState,
  actor: Actor,
  subject: Subject,
  targetId: string,
  offer: Omit<ContractOffer, "teamCode">,
): Decision {
  const full: ContractOffer = { ...offer, teamCode: actor.teamCode };
  const check = checkBid(state, subject, targetId, full);
  if (!check.ok) throw new ActionError(check.reason ?? "That bid isn't allowed.");

  const fa = subject === "players" ? state.freeAgency : state.coachingHire;
  if (!fa) throw new ActionError(subject === "players" ? "The free-agent bidding window has closed." : "The coaching hiring window has closed.");
  const list = (fa.bids[targetId] ??= []);
  const mine = list.findIndex((o) => o.teamCode === actor.teamCode);
  if (mine >= 0) list[mine] = full;
  else list.push(full);

  return {
    events: [
      {
        teamCode: actor.teamCode,
        // sealed until the day resolves — the feed says a bid happened, not
        // what it was, or the auction becomes a staring contest
        kind: "fa.bid",
        summary: `${city(actor.teamCode)} made an offer.`,
        detail: { subject, targetId },
      },
    ],
  };
}

function assetsFrom(state: LeagueState, ids: string[]): TradeAsset[] {
  return ids.map((x) => {
    if (!x.startsWith("pick:")) return { kind: "player" as const, playerId: x };
    const pick = state.draftPicks[x.slice(5)];
    if (!pick) throw new ActionError(`No such draft pick: ${x.slice(5)}`, 404);
    return { kind: "pick" as const, pick };
  });
}

/**
 * Offer a trade. Nothing moves — that's the point of two phases.
 *
 * It still has to be legal *now*, so that nobody is asked to decide on a
 * deal that couldn't be honoured; it will be checked again on acceptance,
 * because by then it may not be.
 */
export function decideProposeTrade(
  state: LeagueState,
  actor: Actor,
  tradeId: string,
  toTeam: string,
  give: string[],
  get: string[],
): Decision {
  if (toTeam === actor.teamCode) throw new ActionError("You can't trade with yourself.");
  if (!state.teams[toTeam]) throw new ActionError("No such team.", 404);
  // like the depth chart: the block's games were played with these rosters
  refuseDuringBlock(state, "Trading");
  if (pastTradeDeadline(state)) throw new ActionError(PAST_DEADLINE_MESSAGE);

  const proposal = {
    id: tradeId,
    fromTeam: actor.teamCode,
    toTeam,
    fromAssets: assetsFrom(state, give),
    toAssets: assetsFrom(state, get),
    aiValueDelta: 0,
    aiAcceptLikelihood: 0.5,
    status: "offered" as const,
  };
  // You can only offer what's yours and only ask for what's theirs. Without
  // this a crafted request could move a third team's player, or one that was
  // traded away an hour ago.
  const ownedBy = (a: TradeAsset, team: string): boolean =>
    a.kind === "pick"
      ? a.pick?.ownedBy === team
      : state.players[a.playerId ?? ""]?.nfl_team === team;

  for (const a of proposal.fromAssets) {
    if (!ownedBy(a, actor.teamCode)) {
      throw new ActionError("You can only offer what you own.", 403);
    }
  }
  for (const a of proposal.toAssets) {
    if (!ownedBy(a, toTeam)) {
      throw new ActionError(`You can only ask for what ${city(toTeam)} owns.`, 400);
    }
  }

  const legal = checkTrade(state, proposal);
  if (!legal.ok) throw new ActionError(legal.reason ?? "That trade isn't allowed.");

  // A CPU team answers on the spot, the way it does in the single-player
  // game. Online nothing answered for it: an offer to a CPU team sat as
  // "offered" for ever, and the screen had told the GM to wait for "the
  // other GM", who didn't exist.
  const partnerIsHuman = state.gms.some((g) => g.isHuman && g.teamCode === toTeam);
  if (!partnerIsHuman) {
    const read = tradeJudge.evaluateTrade(state, actor.teamCode, toTeam, proposal.fromAssets, proposal.toAssets);
    const answered = { ...proposal, aiValueDelta: read.valueDelta, aiAcceptLikelihood: read.acceptLikelihood };
    const accepted = read.acceptLikelihood >= 0.5;
    state.trades.push({ ...answered, status: accepted ? "accepted" : "rejected" });
    if (accepted) applyTrade(state, state.trades[state.trades.length - 1]!);
    recomputeTeamRatings(state);
    return {
      events: [
        {
          teamCode: actor.teamCode,
          kind: accepted ? "trade.accepted" : "trade.rejected",
          summary: accepted
            ? `${city(actor.teamCode)} and ${city(toTeam)} made a trade.`
            : `${city(toTeam)} turned down a trade from ${city(actor.teamCode)}.`,
          detail: { tradeId },
        },
      ],
    };
  }

  state.trades.push(proposal);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "trade.offered",
        summary: `${city(actor.teamCode)} offered ${city(toTeam)} a trade.`,
        detail: { tradeId },
      },
    ],
  };
}

/** Answer a trade offered to you. Acceptance re-checks both sides. */
export function decideRespondToTrade(
  state: LeagueState,
  actor: Actor,
  tradeId: string,
  accept: boolean,
): Decision {
  const t = state.trades.find((x) => x.id === tradeId);
  if (!t) throw new ActionError("No such offer.", 404);
  if (t.toTeam !== actor.teamCode) throw new ActionError("That offer isn't yours.", 403);
  if (t.status !== "offered") throw new ActionError("That offer has already been answered.");

  if (!accept) {
    t.status = "rejected";
    return {
      events: [
        {
          teamCode: actor.teamCode,
          kind: "trade.declined",
          summary: `${city(actor.teamCode)} turned down a trade with ${city(t.fromTeam)}.`,
          detail: { tradeId },
        },
      ],
    };
  }
  // declining is always allowed; accepting moves players mid-block
  refuseDuringBlock(state, "Completing a trade");
  if (pastTradeDeadline(state)) throw new ActionError(PAST_DEADLINE_MESSAGE);

  // Between the offer and this moment either side may have signed someone,
  // gone over the cap, or traded the very player being discussed.
  const legal = checkTrade(state, t);
  if (!legal.ok) {
    if (legal.reason) t.blockedReason = legal.reason;
    throw new ActionError(legal.reason ?? "That trade is no longer legal.", 409);
  }
  // The league vote, online. Single-player simulates the other GMs' ballots;
  // online there were none, so a blockbuster between two GMs went through
  // however lopsided it was. The same guard the simulated vote applies: a
  // deal involving a 90-plus player that the league's own chart reads as a
  // fleecing either way is blocked.
  const involves90 = [...t.fromAssets, ...t.toAssets].some(
    (a) => a.kind === "player" && (state.players[a.playerId ?? ""]?.overall ?? 0) >= 90,
  );
  const bothHuman = [t.fromTeam, t.toTeam].every((c) => state.gms.some((g) => g.isHuman && g.teamCode === c));
  if (involves90 && bothHuman) {
    const read = tradeJudge.evaluateTrade(state, t.fromTeam, t.toTeam, t.fromAssets, t.toAssets);
    if (read.acceptLikelihood >= 0.82 || read.acceptLikelihood <= 0.18) {
      t.status = "blocked";
      t.blockedReason = "The league blocked it: a trade this one-sided, with a 90-plus player in it, reads as collusion.";
      return {
        events: [
          {
            teamCode: actor.teamCode,
            kind: "trade.blocked",
            summary: `The league blocked a trade between ${city(t.fromTeam)} and ${city(t.toTeam)}.`,
            detail: { tradeId },
          },
        ],
      };
    }
  }

  t.status = "accepted";
  applyTrade(state, t);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "trade.accepted",
        summary: `${city(t.fromTeam)} and ${city(t.toTeam)} agreed a trade.`,
        detail: { tradeId },
      },
    ],
  };
}

/** Settling a drafted rookie, online: sign him or let him go. */
export function decideRookieOutcome(
  state: LeagueState,
  actor: Actor,
  prospectId: string,
  released: boolean,
): Decision {
  const check = checkRookieOutcome(state, prospectId, actor.teamCode);
  if (!check.ok) throw new ActionError(check.reason ?? "You can't settle that pick.");
  const name = state.draftClass.find((d) => d.id === prospectId)?.name ?? "the pick";
  applyRookieOutcome(state, prospectId, actor.teamCode, released);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: released ? "rookie.released" : "rookie.signed",
        summary: `${city(actor.teamCode)} ${released ? "released" : "signed"} ${name}.`,
        detail: { prospectId },
      },
    ],
  };
}

/**
 * A coaching-draft pick, online.
 *
 * Mirrors the player draft: the human's pick, then the league takes its own
 * until the clock reaches another person. Without that second half the board
 * stops dead on the first AI team, which with thirty-two teams and three GMs
 * is almost immediately.
 */
export function decideCoachingPick(
  state: LeagueState,
  actor: Actor,
  coachId: string,
): Decision {
  const check = checkCoachingPick(state, actor.teamCode, coachId);
  if (!check.ok) throw new ActionError(check.reason ?? "You can't take him.");
  const coach = state.coaches[coachId]!;
  applyCoachingPick(state, actor.teamCode, coachId);

  const humans = new Set(
    state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode),
  );
  const aiPicks = runAiCoachingPicks(state, humans);

  // When the last job is filled the stage is over — there is nothing left to
  // decide, so nobody is asked to confirm it, the same as the player draft.
  const finished = coachingDraftComplete(state);
  if (finished) {
    const t = resolveTransition(state, {});
    state.stage = t.stage;
    state.week = t.week;
    onStageEntered(state, "coachingDraft");
    clearReadinessOnline(state);
  }

  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "coach.drafted",
        summary: `${city(actor.teamCode)} hired ${coach.name} as ${COACH_ROLE_LABEL[coach.role] ?? coach.role}.`,
        detail: { coachId },
      },
      ...(aiPicks > 0 && !finished
        ? [{ kind: "coach.ai", summary: `${aiPicks} staff pick${aiPicks === 1 ? " was" : "s were"} made around the league.` }]
        : []),
      ...(finished
        ? [{ kind: "coach.draft.done", summary: "Every staff is complete." }]
        : []),
    ],
  };
}

/**
 * One free-agency turn: an offer, or a pass.
 *
 * The turn ends either way, and the CPU teams behind you take theirs before
 * this returns — so the league comes back to the next human rather than
 * stopping on the first computer. When the last team in a round acts the
 * round resolves inside the same transaction, which is what makes "nothing
 * signs mid-round" true rather than merely intended.
 */
export function decideFreeAgencyTurn(
  state: LeagueState,
  actor: Actor,
  move: {
    playerId?: string | undefined;
    salary?: number | undefined;
    years?: number | undefined;
    pass?: boolean | undefined;
  },
): Decision {
  const e = state.freeAgencyEvent;
  if (!e || e.complete) throw new ActionError("Free agency isn't running.");
  if (onTheClock(state) !== actor.teamCode) throw new ActionError("It isn't your turn.", 409);

  const roundBefore = e.round;
  let summary: string;

  if (move.pass || !move.playerId) {
    applyPass(state, actor.teamCode);
    summary = `${city(actor.teamCode)} passed.`;
  } else {
    const salary = Number(move.salary);
    const years = Number(move.years);
    const check = checkOffer(state, actor.teamCode, move.playerId, salary, years);
    if (!check.ok) throw new ActionError(check.reason ?? "That offer isn't valid.");
    const name = state.players[move.playerId]?.name ?? "a free agent";
    applyOffer(state, actor.teamCode, move.playerId, salary, years);
    summary = `${city(actor.teamCode)} offered ${name} $${salary.toFixed(1)}M a year for ${years} year${years === 1 ? "" : "s"}.`;
  }

  const humans = new Set(
    state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode),
  );
  runCpuTurns(state, humans);

  const resolved = state.freeAgencyEvent!.round !== roundBefore || state.freeAgencyEvent!.complete;
  const signedThisRound = state.freeAgencyEvent!.signed.filter((x) => x.round === roundBefore);

  // The event ending is a stage change, not a prompt — there is nothing left
  // to decide once the fifth round resolves. This event runs twice a season
  // (the opening market and Change 9's midseason window), on two different
  // stages, so the guard has to recognise both — checking only "freeAgency"
  // left a league that played midseason free agency to its natural
  // conclusion stuck there forever, with no other way off the stage.
  const from = state.stage;
  if (state.freeAgencyEvent!.complete && (from === "freeAgency" || from === "midseasonFreeAgency")) {
    const t = resolveTransition(state, {});
    state.stage = t.stage;
    state.week = t.week;
    onStageEntered(state, from);
    clearReadinessOnline(state);
  }

  return {
    events: [
      { teamCode: actor.teamCode, kind: "fa.turn", summary },
      ...(resolved && signedThisRound.length > 0
        ? [
            {
              kind: "fa.round",
              summary: `Round ${roundBefore} closed — ${signedThisRound.length} player${signedThisRound.length === 1 ? "" : "s"} signed.`,
            },
          ]
        : []),
    ],
  };
}

/** Running one team's training camp. */
export function decideTrainingCamp(
  state: LeagueState,
  actor: Actor,
  plan: TrainingCampPlan,
): Decision {
  if (state.stage !== "trainingCamp") throw new ActionError("It isn't training camp.");
  if (state.trainingCamp?.plans[actor.teamCode]?.submitted) {
    throw new ActionError("You've already run camp.");
  }
  const check = checkCampSubmission(plan);
  if (!check.ok) throw new ActionError(check.reason ?? "Camp can't run yet.");

  runTrainingCamp(state, actor.teamCode, plan);

  // Camp is a single-player section: this GM moves on alone, and the others
  // run theirs whenever they get to it. The checkpoint is later, after the
  // depth chart.
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "camp.run",
        summary: `${city(actor.teamCode)} finished training camp.`,
      },
    ],
  };
}

/**
 * Committing (or declining) the hooded-figure offer.
 *
 * Resolved immediately and permanently, same as every other bargain rule —
 * `resolveHoodedFigureEncounter` is the one place this ever happens, and it
 * refuses outright if this GM's encounter is already resolved.
 */
export function decideHoodedFigurePayment(state: LeagueState, actor: Actor, payment: number): Decision {
  if (state.stage !== "hoodedFigureEncounter") throw new ActionError("The figure is gone — the league has moved past training camp.");
  const existing = hoodedFigureEncounterFor(state, actor.teamCode);
  if (existing?.resolved) throw new ActionError("You've already answered the figure this year.");
  const check = checkHoodedFigurePayment(state, actor.teamCode, payment);
  if (!check.ok) throw new ActionError(check.reason ?? "That offer isn't valid.");

  resolveHoodedFigureEncounter(state, actor.teamCode, payment);
  recomputeTeamRatings(state);

  // §25.5/§29: the event feed is readable by every GM in the league, so this
  // has to be indistinguishable from an ordinary training-camp event —
  // "kind" included. Whatever actually happened is only ever visible to this
  // GM (the encounter record itself) and, once resolved, to everyone equally
  // through the League Developments screen — never through the feed.
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "camp.run",
        summary: `${city(actor.teamCode)} finished training camp.`,
      },
    ],
  };
}

/**
 * Reveal saved results to one GM.
 *
 * Never simulates. The block was played at the checkpoint, so this only moves
 * this GM's marker — which is why one person racing ahead cannot change
 * anybody else's screen or the league's results.
 */
/**
 * Reveal the next playoff round to one GM.
 *
 * One round at a time and no reveal-all, which is the one place the playoffs
 * differ from the regular season on purpose: there are four of them, each
 * decides who is left, and watching them in a batch is watching the season
 * end in a paragraph.
 */
/**
 * Step one GM forward inside a stage that holds several screens.
 *
 * Change 12: the retirement review and the draft preview are one league
 * stage and two screens, and crossing between them is this GM's business
 * alone. Irreversible like every other advance — the marker only moves
 * forward, so a back button lands on the screen they committed to rather
 * than on the one they left.
 */
/** Star or unstar a prospect — private to this GM, stripped from everyone else's view. */
export function decideDraftTarget(state: LeagueState, actor: Actor, prospectId: string): Decision {
  if (!state.draftClass?.some((p) => p.id === prospectId)) {
    throw new ActionError("That prospect isn't in this draft class.");
  }
  toggleDraftTargetFor(state, actor.gmId, prospectId);
  // private: no event, nothing for the other GMs' tickers to read
  return { events: [] };
}

export function decideStep(state: LeagueState, actor: Actor, step: string): Decision {
  markStep(state, actor.gmId, step);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "step",
        summary: `${city(actor.teamCode)} moved on.`,
      },
    ],
  };
}

export function decideRevealRound(state: LeagueState, actor: Actor): Decision {
  if (state.stage !== "playoffs") throw new ActionError("There's no round to reveal.");
  const seen = revealedRounds(state, actor.gmId);
  // the bracket's own rounds: a humans-only league's is just the final, or a
  // semifinal and a final — not the NFL's four
  const next = (state.bracket ? bracketRounds(state.bracket) : ROUND_ORDER).find((r) => !seen.includes(r));
  if (!next) throw new ActionError("You've watched the whole postseason.");
  // a round a GM has not been given yet cannot be revealed — it exists in
  // saved state, which is exactly why this has to be checked rather than
  // assumed from the button being on screen
  const exists = state.bracket?.matchups.some((m) => m.round === next && m.winner != null);
  if (!exists) throw new ActionError("That round hasn't been played yet.");

  markRoundRevealed(state, actor.gmId, next);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "reveal",
        summary: `${city(actor.teamCode)} watched the ${roundLabelFor(state.bracket, next)}.`,
      },
    ],
  };
}

export function decideReveal(
  state: LeagueState,
  actor: Actor,
  through: number,
): Decision {
  const phase = state.stage === "preseason" ? "PRE" : "REG";
  if (state.stage !== "preseason" && state.stage !== "regularSeason") {
    throw new ActionError("There's nothing to reveal right now.");
  }
  const already = revealedWeek(state, actor.gmId, phase);
  if (through <= already) throw new ActionError("You've already seen that week.");

  markRevealed(state, actor.gmId, phase, through);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "reveal",
        summary: `${city(actor.teamCode)} watched through ${phase === "PRE" ? "Preseason " : ""}Week ${through}.`,
      },
    ],
  };
}

/** Hiring a coach, online: same ruling, applied by the server. */
export function decideCoachHire(state: LeagueState, actor: Actor, coachId: string): Decision {
  // the staff shapes games that are already played this block
  refuseDuringBlock(state, "Hiring coaches");
  const check = checkCoachHire(state, coachId, actor.teamCode);
  if (!check.ok) throw new ActionError(check.reason ?? "You can't hire him.");
  const coach = state.coaches[coachId]!;
  applyCoachHire(state, coachId, actor.teamCode);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "coach.hired",
        summary: `${city(actor.teamCode)} hired ${coach.name} as ${COACH_ROLE_LABEL[coach.role] ?? coach.role}.`,
        detail: { coachId },
      },
    ],
  };
}

export function decideDraftPick(state: LeagueState, actor: Actor, selectedId: string): Decision {
  const draft = state.draft;
  if (!draft) throw new ActionError("There's no draft running.");
  const onTheClock = draft.pickOrder[draft.currentPickIndex];
  // past the last pick nobody is on the clock — it read " is on the clock"
  if (!onTheClock) throw new ActionError("The draft is over.", 409);
  if (onTheClock !== actor.teamCode) {
    throw new ActionError(`${city(onTheClock)} is on the clock, not you.`, 409);
  }
  const takenBy = draft.results.find((r) => r.selectedId === selectedId);
  if (takenBy) throw new ActionError(`${city(takenBy.teamCode)} already drafted him — pick again.`, 409);

  const name =
    state.draftClass.find((p) => p.id === selectedId)?.name ??
    state.players[selectedId]?.name ??
    null;
  if (!name) throw new ActionError("That isn't someone you can pick.", 404);

  applyPick(state, selectedId);
  // then the league takes its own picks, up to the next one a person owes —
  // otherwise the clock stops dead on the first AI team after you
  const aiPicked = runAiPicks(state);

  // Change 1: manual drafting runs until every human GM has taken the number
  // of picks the commissioner asked for. The moment the last of them does,
  // the rest of the board completes at once and the league moves on — there
  // is nothing left for anyone to decide, so nobody is asked to confirm it.
  // A fully manual draft (threshold null) never trips that, but the board
  // can still finish on its own once this human's last pick lets
  // `runAiPicks` sweep every remaining (all-AI) slot — that has to advance
  // the stage too, there's just nothing left for `completeDraft` to do.
  const boardDone = draft.currentPickIndex >= draft.pickOrder.length;
  const finishing = draftThresholdMet(state) || boardDone;
  const autoCompleted = finishing && !boardDone ? completeDraft(state) : 0;
  if (finishing) {
    const was = state.stage;
    const t = resolveTransition(state, {});
    state.stage = t.stage;
    state.week = t.week;
    // the stage it came from, not a guess: the rookie and fantasy drafts both
    // end here and they enter different stages afterwards
    onStageEntered(state, was);
    clearReadinessOnline(state);
  }

  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "draft.pick",
        summary: `${city(actor.teamCode)} selected ${name}.`,
        detail: { selectedId },
      },
      ...(aiPicked.length && !finishing
        ? [
            {
              kind: "draft.ai",
              summary:
                aiPicked.length === 1
                  ? `${city(aiPicked[0]!)} made their pick.`
                  : `${aiPicked.length} teams made their picks.`,
            },
          ]
        : []),
      ...(finishing
        ? [
            {
              kind: "draft.completed",
              summary: autoCompleted
                ? `Every GM has made their picks — the remaining ${autoCompleted} selection${autoCompleted === 1 ? " was" : "s were"} made automatically.`
                : "The draft is complete.",
            },
          ]
        : []),
    ],
  };
}

/** Set the depth order at one position, for your own team only. */
/**
 * Whether the league is inside a precomputed block right now.
 *
 * Changes 6 and 7 lock the roster, the depth chart and the coaching staff for
 * the length of a block, and this is where that lock is actually enforced.
 * The UI already hides the controls, but hiding a button is a courtesy, not a
 * rule: a stale tab, a replayed request or a second device would otherwise
 * change a lineup that games already played against, and every result from
 * that week onward would stop matching the roster it was produced from.
 */
function refuseDuringBlock(state: LeagueState, what: string): void {
  if (state.stage === "preseason" || state.stage === "regularSeason") {
    throw new ActionError(
      `${what} is locked — these weeks are already played. You'll get it back at the next break.`,
    );
  }
}

export function decideSetDepth(
  state: LeagueState,
  actor: Actor,
  position: Position,
  playerIds: string[],
): Decision {
  refuseDuringBlock(state, "The depth chart");
  const mine = new Set(
    Object.values(state.players)
      .filter((p) => p.nfl_team === actor.teamCode)
      .map((p) => p.id),
  );
  (state.depthChart[actor.teamCode] ??= {})[position] = playerIds.filter((id) => mine.has(id));
  recomputeTeamRatings(state);
  return { events: [] };
}

/** Release a player. */
/**
 * The staff squares a GM's roster up at a free-agency summary: cuts to the
 * cap and the limit, and signs a street free agent into any empty position.
 *
 * The summary's own button only cut. A GM short a guard had no way to fill
 * the hole from that screen and no way past it — the check-in stays locked
 * until the roster is legal — so they were stuck. This is the same
 * reconciliation the CPU teams get, on the GM's say-so.
 */
export function decideStaffFix(state: LeagueState, actor: Actor): Decision {
  if (state.stage !== "freeAgencySummary" && state.stage !== "midseasonFreeAgencySummary") {
    throw new ActionError("Your staff only does this at a free-agency summary.");
  }
  const before = new Set(
    Object.values(state.players).filter((p) => p.nfl_team === actor.teamCode && !p.retired && !p.free_agent).map((p) => p.id),
  );
  reconcileCpuTeam(state, actor.teamCode);
  recomputeTeamRatings(state);
  const after = Object.values(state.players).filter((p) => p.nfl_team === actor.teamCode && !p.retired && !p.free_agent);
  const named = (ps: { name: string; position: string }[]) => ps.map((p) => `${p.name} (${posLabel(p.position)})`).join(", ");
  const signed = after.filter((p) => !before.has(p.id));
  const cut = [...before].filter((id) => !after.some((p) => p.id === id)).map((id) => state.players[id]).filter((p) => !!p);
  const left = reconciliationIssues(state, actor.teamCode).length;
  // "released 0 and signed 0" when the roster was already legal said nothing
  if (signed.length === 0 && cut.length === 0) return { events: [], unchanged: true };
  const did = [cut.length ? `released ${named(cut)}` : "", signed.length ? `signed ${named(signed)}` : ""].filter(Boolean);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "roster.staff",
        summary: `${city(actor.teamCode)}'s staff ${did.join(" and ")} to make the roster legal${left ? " (some of it couldn't be fixed)" : ""}.`,
      },
    ],
  };
}

export function decideRelease(state: LeagueState, actor: Actor, playerId: string): Decision {
  refuseDuringBlock(state, "Releasing players");
  const p = state.players[playerId];
  if (!p) throw new ActionError("No such player.", 404);
  if (p.nfl_team !== actor.teamCode) throw new ActionError("He isn't yours to release.", 403);
  // the same rule and the same dead money as a reconciliation cut — this
  // path used to skip both, so a player signed an hour ago could be cut for
  // nothing
  const check = checkRelease(state, actor.teamCode, playerId);
  if (!check.ok) throw new ActionError(check.reason ?? "You can't release him.");
  applyRelease(state, actor.teamCode, playerId);
  recomputeTeamRatings(state);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "roster.released",
        summary: `${city(actor.teamCode)} released ${p.name} (${posLabel(p.position)}).`,
        detail: { playerId },
      },
    ],
  };
}

export type ContractMove =
  | { kind: "restructure" }
  | { kind: "tag" }
  | { kind: "option" }
  | { kind: "practiceSquad" }
  | { kind: "promote" }
  | { kind: "extend"; baseSalary: number; years: number; guaranteed: number };

/** Restructure or extend one of your contracts. */
export function decideContractMove(
  state: LeagueState,
  actor: Actor,
  playerId: string,
  move: ContractMove,
): Decision {
  const p = state.players[playerId];
  if (!p) throw new ActionError("No such player.", 404);
  if (p.nfl_team !== actor.teamCode && practiceSquadTeam(p) !== actor.teamCode) throw new ActionError("He isn't yours.", 403);
  const out =
    move.kind === "restructure"
      ? restructureContract(p, state.season)
      : move.kind === "tag"
        ? franchiseTag(state, p)
        : move.kind === "option"
          ? exerciseFifthYearOption(state, p)
          : move.kind === "practiceSquad"
            ? toPracticeSquad(state, p)
            : move.kind === "promote"
              ? promoteFromPracticeSquad(state, p)
              : extendContract(state, p, move);
  if (!out.ok) throw new ActionError(out.reason ?? "That contract move isn't allowed.");
  recomputeTeamRatings(state);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: `contract.${move.kind}`,
        summary:
          move.kind === "restructure"
            ? `${city(actor.teamCode)} restructured ${p.name}'s deal.`
            : move.kind === "tag"
              ? `${city(actor.teamCode)} put the franchise tag on ${p.name}.`
              : move.kind === "option"
                ? `${city(actor.teamCode)} picked up ${p.name}'s fifth-year option.`
                : move.kind === "practiceSquad"
                  ? `${city(actor.teamCode)} moved ${p.name} to the practice squad.`
                  : move.kind === "promote"
                    ? `${city(actor.teamCode)} promoted ${p.name} from the practice squad.`
                    : `${city(actor.teamCode)} extended ${p.name}.`,
        detail: { playerId },
      },
    ],
  };
}

/**
 * A trade-deadline turn, whichever kind it is.
 *
 * All four verbs land here because they share one postcondition: whatever a
 * human just did, the league then runs itself forward to the next human. If
 * that ran anywhere else, a CPU-only stretch of the order would sit there
 * until somebody happened to poll.
 */
export function decideDeadlineTurn(
  state: LeagueState,
  actor: Actor,
  move:
    | { kind: "propose"; toTeam: string; give: string[]; get: string[] }
    | { kind: "skip" }
    | { kind: "accept" }
    | { kind: "deny" }
    /**
     * A counter replaces the whole package, and always in the original
     * orientation: `proposerGives` is what the team that opened the
     * negotiation sends, whichever side is doing the countering. Stating it
     * that way is the only version that survives the offer changing hands.
     */
    | { kind: "modify"; proposerGives: string[]; proposerGets: string[] },
): Decision {
  if (state.stage !== "tradeDeadline") throw new ActionError("The deadline isn't open.");

  let result: { ok: boolean; reason?: string };
  let summary: string;
  switch (move.kind) {
    case "propose":
      result = proposeAtDeadline(
        state,
        actor.teamCode,
        move.toTeam,
        assetsFrom(state, move.give),
        assetsFrom(state, move.get),
      );
      summary = `${city(actor.teamCode)} made an offer to ${city(move.toTeam)}.`;
      break;
    case "skip":
      result = skipTurn(state, actor.teamCode);
      summary = `${city(actor.teamCode)} passed on their turn.`;
      break;
    case "modify":
      result = respondAtDeadline(state, actor.teamCode, {
        kind: "modify",
        fromAssets: assetsFrom(state, move.proposerGives),
        toAssets: assetsFrom(state, move.proposerGets),
      });
      summary = `${city(actor.teamCode)} countered.`;
      break;
    default:
      result = respondAtDeadline(state, actor.teamCode, { kind: move.kind });
      summary =
        move.kind !== "accept"
          ? `${city(actor.teamCode)} turned an offer down.`
          : "blocked" in result && result.blocked
            ? `The league blocked a deadline trade involving ${city(actor.teamCode)}.`
            : `${city(actor.teamCode)} accepted a trade.`;
  }
  if (!result.ok) throw new ActionError(result.reason ?? "That move isn't available.");

  runDeadlineTurns(state);

  // Three rounds and `tradeDeadline.ts` marks itself `done` — nothing ever
  // read that flag, so a league that finished round three simply had no
  // further turns to make and no way off the stage (playtest finding 16).
  if (state.tradeDeadline?.done) {
    const t = resolveTransition(state, {});
    state.stage = t.stage;
    state.week = t.week;
    onStageEntered(state, "tradeDeadline");
    clearReadinessOnline(state);
  }

  return { events: [{ teamCode: actor.teamCode, kind: "trade.deadline", summary }] };
}

/**
 * Play whatever CPU turns are due in the current turn-based event, and end
 * the event if that finishes it — the same steps a human's move triggers.
 *
 * CPU turns only ever ran as a follow-on to a person's move, so a seat
 * reopened while that team was on the clock left the coaching draft, the
 * market or the deadline waiting on a CPU that nothing would prompt.
 */
export function runPendingCpuTurns(state: LeagueState): boolean {
  const humans = new Set(state.gms.filter((g) => g.isHuman && g.teamCode).map((g) => g.teamCode));
  const finish = (from: string): void => {
    const t = resolveTransition(state, {});
    state.stage = t.stage;
    state.week = t.week;
    onStageEntered(state, from);
    clearReadinessOnline(state);
  };
  const stage = state.stage;
  if ((stage === "fantasyDraft" || stage === "offseasonDraft") && state.draft) {
    runAiPicks(state);
    const boardDone = state.draft.currentPickIndex >= state.draft.pickOrder.length;
    if (draftThresholdMet(state) || boardDone) {
      if (!boardDone) completeDraft(state);
      finish(stage);
      return true;
    }
    return false;
  }
  if (stage === "coachingDraft" && state.coachingDraft) {
    runAiCoachingPicks(state, humans);
    if (coachingDraftComplete(state)) {
      finish(stage);
      return true;
    }
    return false;
  }
  if ((stage === "freeAgency" || stage === "midseasonFreeAgency") && state.freeAgencyEvent && !state.freeAgencyEvent.complete) {
    runCpuTurns(state, humans);
    if (state.freeAgencyEvent.complete) {
      finish(stage);
      return true;
    }
    return false;
  }
  if (stage === "tradeDeadline" && state.tradeDeadline && !state.tradeDeadline.done) {
    runDeadlineTurns(state);
    if (state.tradeDeadline.done) {
      finish(stage);
      return true;
    }
  }
  return false;
}

/**
 * A GM chooses to sit out free agency, or the trade deadline: from here their
 * own turns are passed for them. Only theirs — and at the deadline, offers made
 * to them still arrive and wait for their answer.
 *
 * If it is their turn right now, it is passed right now, and the event
 * finishes if that was the last thing it was waiting on.
 */
export function decideSkipPreference(
  state: LeagueState,
  actor: Actor,
  kind: "freeAgency" | "tradeDeadline",
  on: boolean,
): Decision {
  if (kind !== "freeAgency" && kind !== "tradeDeadline") throw new ActionError("You can skip free agency or the deadline.");
  if (!setSkip(state, actor.teamCode, kind, on)) throw new ActionError("You don't have a team.", 403);
  runPendingCpuTurns(state);
  const what = kind === "freeAgency" ? "free agency" : "the trade deadline";
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "skip.set",
        summary: on ? `${city(actor.teamCode)} will sit out ${what}.` : `${city(actor.teamCode)} is back in for ${what}.`,
      },
    ],
  };
}

/**
 * Take back an offer nobody has answered yet. It used to stay binding until
 * the other GM got round to it — days, sometimes, after your plans changed.
 */
export function decideWithdrawTrade(state: LeagueState, actor: Actor, tradeId: string): Decision {
  const t = state.trades.find((x) => x.id === tradeId);
  if (!t) throw new ActionError("No such offer.", 404);
  if (t.fromTeam !== actor.teamCode) throw new ActionError("That offer isn't yours to withdraw.", 403);
  if (t.status !== "offered") throw new ActionError("That offer has already been answered.");
  t.status = "withdrawn";
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "trade.withdrawn",
        summary: `${city(actor.teamCode)} withdrew an offer to ${city(t.toTeam)}.`,
        detail: { tradeId },
      },
    ],
  };
}
