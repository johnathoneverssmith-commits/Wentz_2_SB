/**
 * The game actions, as endpoints.
 *
 * Thin on purpose. Each one resolves who is asking, opens the transaction,
 * and hands the state to the matching `decide*` function in `decide.ts` —
 * which is where the actual ruling lives, and which is pure so it can be
 * tested without a database.
 *
 * The inversion this file represents is the whole point of the online build.
 * Single-player, the client computed the next state and told the server about
 * it. Here the client sends an *intent* and the server decides, re-running
 * the same legality functions the client used to grey out the button —
 * against the league as it is at commit time, not as the client last saw it.
 */
import type { ContractOffer, Position } from "@/domain";
import { planAutopicks, type Subject } from "@/state/rules.ts";
import type { LeagueState } from "@/domain";

import { franchiseOf, isCommissioner } from "./auth.js";
import { ActionError, withLeague, type Applied } from "./db.js";
import {
  decideContractMove,
  decideCoachHire,
  decideCoachingPick,
  decideFreeAgencyTurn,
  decideRookieOutcome,
  decideDraftPick,
  decidePlaceBid,
  decideProposeTrade,
  decideRelease,
  decideRespondToTrade,
  decideSetDepth,
  decideSignFreeAgent,
  type Actor,
  type ContractMove,
  type Decision,
} from "./decide.js";

export type { Actor } from "./decide.js";

/** Resolve the caller's franchise. Ownership is read from the database. */
export async function actorFor(leagueId: string, userId: string): Promise<Actor> {
  const f = await franchiseOf(leagueId, userId);
  if (!f || f.teamCode.startsWith("unclaimed:")) {
    throw new ActionError("You don't have a team in this league.", 403);
  }
  return { userId, leagueId, teamCode: f.teamCode, gmId: f.gmId };
}

/** The shape every action here shares: lock, decide, persist, log. */
async function run(
  actor: Actor,
  expectedVersion: string | undefined,
  decide: (state: LeagueState) => Decision,
): Promise<{ ok: true; version: string }> {
  const { version } = await withLeague(
    actor.leagueId,
    async ({ state }) => {
      const decision = decide(state);
      return {
        result: { ok: true } as const,
        state,
        events: decision.events,
      } satisfies { result: { ok: true } } & Applied;
    },
    { expectedVersion, actorUserId: actor.userId },
  );
  return { ok: true, version };
}

export const signFreeAgent = (
  actor: Actor,
  playerId: string,
  offer: Omit<ContractOffer, "teamCode">,
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decideSignFreeAgent(s, actor, playerId, offer));

export const placeBid = (
  actor: Actor,
  subject: Subject,
  targetId: string,
  offer: Omit<ContractOffer, "teamCode">,
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decidePlaceBid(s, actor, subject, targetId, offer));

export async function proposeTrade(
  actor: Actor,
  toTeam: string,
  give: string[],
  get: string[],
  expectedVersion?: string,
): Promise<{ ok: true; version: string; tradeId: string }> {
  const tradeId = `trade_${Date.now()}_${actor.teamCode}`;
  const out = await run(actor, expectedVersion, (s) =>
    decideProposeTrade(s, actor, tradeId, toTeam, give, get),
  );
  return { ...out, tradeId };
}

export const respondToTrade = (
  actor: Actor,
  tradeId: string,
  accept: boolean,
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decideRespondToTrade(s, actor, tradeId, accept));

export const makeDraftPick = (actor: Actor, selectedId: string, expectedVersion?: string) =>
  run(actor, expectedVersion, (s) => decideDraftPick(s, actor, selectedId));

export const settleRookie = (
  actor: Actor,
  prospectId: string,
  released: boolean,
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decideRookieOutcome(s, actor, prospectId, released));

export const freeAgencyTurn = (
  actor: Actor,
  move: {
    playerId?: string | undefined;
    salary?: number | undefined;
    years?: number | undefined;
    pass?: boolean | undefined;
  },
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decideFreeAgencyTurn(s, actor, move));

export const draftCoach = (actor: Actor, coachId: string, expectedVersion?: string) =>
  run(actor, expectedVersion, (s) => decideCoachingPick(s, actor, coachId));

export const hireCoach = (actor: Actor, coachId: string, expectedVersion?: string) =>
  run(actor, expectedVersion, (s) => decideCoachHire(s, actor, coachId));

export const setDepthOrder = (actor: Actor, position: Position, playerIds: string[]) =>
  run(actor, undefined, (s) => decideSetDepth(s, actor, position, playerIds));

export const releasePlayer = (actor: Actor, playerId: string, expectedVersion?: string) =>
  run(actor, expectedVersion, (s) => decideRelease(s, actor, playerId));

export const contractMove = (
  actor: Actor,
  playerId: string,
  move: ContractMove,
  expectedVersion?: string,
) => run(actor, expectedVersion, (s) => decideContractMove(s, actor, playerId, move));

/** The pick the AI would make — what the deadline sweeper uses, nothing else. */
export function autopickFor(state: LeagueState, teamCode: string): string | null {
  const draft = state.draft;
  if (!draft || draft.pickOrder[draft.currentPickIndex] !== teamCode) return null;
  return planAutopicks(state)[0] ?? null;
}

export { isCommissioner };
