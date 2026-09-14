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
import type { ContractOffer, LeagueState, Position, TradeAsset } from "@/domain";
import { TEAMS_BY_CODE } from "@/data/teams";
import {
  applyPick,
  applyTrade,
  checkBid,
  checkStandingSign,
  checkTrade,
  offerToContract,
  type Subject,
} from "@/state/rules.ts";
import { extendContract, restructureContract } from "@/state/contracts.ts";
import { recomputeTeamRatings, releaseToMarket } from "@/state/seed.ts";

import { ActionError } from "./db.js";

/** Who is asking. Resolved from the database, never from the request body. */
export interface Actor {
  userId: string;
  leagueId: string;
  teamCode: string;
  gmId: string;
}

export interface Decision {
  events: { teamCode?: string | undefined; kind: string; summary: string; detail?: unknown }[];
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
        summary: `${city(actor.teamCode)} signed ${p.name} (${p.position}) for $${offer.baseSalary.toFixed(1)}M a year.`,
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
  if (!fa) throw new ActionError("The window isn't open.");
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

  // Between the offer and this moment either side may have signed someone,
  // gone over the cap, or traded the very player being discussed.
  const legal = checkTrade(state, t);
  if (!legal.ok) {
    if (legal.reason) t.blockedReason = legal.reason;
    throw new ActionError(legal.reason ?? "That trade is no longer legal.", 409);
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

/** Make the pick on the clock, if it's yours. */
export function decideDraftPick(state: LeagueState, actor: Actor, selectedId: string): Decision {
  const draft = state.draft;
  if (!draft) throw new ActionError("There's no draft running.");
  const onTheClock = draft.pickOrder[draft.currentPickIndex];
  if (onTheClock !== actor.teamCode) {
    throw new ActionError(`${city(onTheClock ?? "")} is on the clock, not you.`, 409);
  }
  const taken = new Set(draft.results.map((r) => r.selectedId));
  if (taken.has(selectedId)) throw new ActionError("He's already gone.", 409);

  const name =
    state.draftClass.find((p) => p.id === selectedId)?.name ??
    state.players[selectedId]?.name ??
    null;
  if (!name) throw new ActionError("That isn't someone you can pick.", 404);

  applyPick(state, selectedId);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "draft.pick",
        summary: `${city(actor.teamCode)} selected ${name}.`,
        detail: { selectedId },
      },
    ],
  };
}

/** Set the depth order at one position, for your own team only. */
export function decideSetDepth(
  state: LeagueState,
  actor: Actor,
  position: Position,
  playerIds: string[],
): Decision {
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
export function decideRelease(state: LeagueState, actor: Actor, playerId: string): Decision {
  const p = state.players[playerId];
  if (!p) throw new ActionError("No such player.", 404);
  if (p.nfl_team !== actor.teamCode) throw new ActionError("He isn't yours to release.", 403);
  releaseToMarket(state, p);
  recomputeTeamRatings(state);
  return {
    events: [
      {
        teamCode: actor.teamCode,
        kind: "roster.released",
        summary: `${city(actor.teamCode)} released ${p.name} (${p.position}).`,
        detail: { playerId },
      },
    ],
  };
}

export type ContractMove =
  | { kind: "restructure" }
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
  if (p.nfl_team !== actor.teamCode) throw new ActionError("He isn't yours.", 403);
  const out = move.kind === "restructure" ? restructureContract(p) : extendContract(state, p, move);
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
            : `${city(actor.teamCode)} extended ${p.name}.`,
        detail: { playerId },
      },
    ],
  };
}
