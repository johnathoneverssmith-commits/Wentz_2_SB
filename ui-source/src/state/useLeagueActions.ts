/**
 * One interface over "act locally" and "ask the server", so a screen doesn't
 * have to know which league it's in.
 *
 * Every verb here is async, and that's the whole design problem in one word.
 * Locally a cap check fails instantly; online it fails after a round trip,
 * against a league that may have moved since the page loaded. A screen that
 * assumes the first can never work online, so the shared interface takes the
 * slower shape and the local implementation simply resolves immediately.
 *
 * The store's own actions keep their synchronous signatures. That is
 * deliberate: single-player is finished and working, and converting twenty
 * screens to `await` for a mode that isn't switched on yet would put a
 * working game at risk for no gain today. Screens migrate to this hook one
 * at a time, and the ones that haven't go on calling the store directly.
 */
import { useCallback, useEffect, useMemo } from "react";

import type { ContractOffer, Position } from "@/domain";

import { isOnline, onLeagueChange, onlineSession, pull, send } from "./online.ts";
import { useStore } from "./store.ts";

export interface ActionResult {
  ok: boolean;
  reason?: string;
  /**
   * Cap space a restructure freed, in millions — local only.
   *
   * The local action computes it as it applies it, so it is exact. The server
   * answers with the new league instead, and a screen that wants the figure
   * has to price it itself; `previewRestructure` is the same arithmetic and
   * lands within a rounding step.
   */
  freed?: number;
}

export interface LeagueActions {
  /** True when these calls are going to a server rather than to memory. */
  online: boolean;
  signFreeAgent: (playerId: string, offer: ContractOffer) => Promise<ActionResult>;
  placeBid: (
    subject: "players" | "coaches",
    targetId: string,
    offer: ContractOffer,
  ) => Promise<ActionResult>;
  proposeTrade: (toTeam: string, give: string[], get: string[]) => Promise<ActionResult>;
  respondToTrade: (tradeId: string, accept: boolean) => Promise<ActionResult>;
  makeDraftPick: (selectedId: string) => Promise<ActionResult>;
  setDepthOrder: (position: Position, playerIds: string[]) => Promise<ActionResult>;
  releasePlayer: (playerId: string) => Promise<ActionResult>;
  restructure: (playerId: string) => Promise<ActionResult>;
  extend: (
    playerId: string,
    terms: { baseSalary: number; years: number; guaranteed: number },
  ) => Promise<ActionResult>;
  /** Sign or release a rookie you drafted. */
  settleRookie: (prospectId: string, released: boolean) => Promise<ActionResult>;
  /** One free-agency turn: an offer, or a pass. */
  freeAgencyTurn: (move: {
    playerId?: string;
    salary?: number;
    years?: number;
    pass?: boolean;
  }) => Promise<ActionResult>;
  /** Take a coach in the coaching fantasy draft. */
  draftCoach: (coachId: string) => Promise<ActionResult>;
  hireCoach: (coachId: string) => Promise<ActionResult>;
  readyUp: (ready: boolean) => Promise<ActionResult>;
  /**
   * Commissioner override: move the league on now, whoever is or isn't here.
   * Offline there is nobody to overrule, so it refuses rather than pretending.
   */
  forceAdvance: () => Promise<ActionResult>;
  /** Pull the server's copy and replace the local one. No-op offline. */
  refresh: () => Promise<void>;
}

/** Turns a thrown `OnlineError` into the same shape a local refusal has. */
async function attempt(run: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await run();
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export function useLeagueActions(): LeagueActions {
  const store = useStore();
  const online = isOnline();

  const replaceState = useCallback(() => {
    // the server's copy is the league; this is not a merge
    void pull().then((state) => {
      if (state) useStore.setState(state as never);
    });
  }, []);

  return useMemo<LeagueActions>(() => {
    if (!online) {
      return {
        online: false,
        signFreeAgent: async (playerId, offer) => store.signStandingFreeAgent(playerId, offer),
        placeBid: async (subject, targetId, offer) => store.placeOffer(subject, targetId, offer),
        proposeTrade: async (toTeam, give, get) => {
          const id = store.proposeTrade(toTeam, give, get);
          store.resolveTrade(id);
          return { ok: true };
        },
        respondToTrade: async (tradeId, accept) => store.respondToOffer(tradeId, accept),
        makeDraftPick: async (selectedId) => {
          store.makePick(selectedId);
          return { ok: true };
        },
        setDepthOrder: async (position, playerIds) => {
          const code = store.gms.find((g) => g.id === store.viewerGmId)?.teamCode;
          if (code) store.setDepthOrder(code, position, playerIds);
          return { ok: true };
        },
        releasePlayer: async (playerId) => {
          store.releasePlayer(playerId);
          return { ok: true };
        },
        restructure: async (playerId) => store.restructurePlayer(playerId),
        extend: async (playerId, terms) => store.extendPlayer(playerId, terms),
        settleRookie: async (prospectId, released) => {
          const code = store.gms.find((g) => g.id === store.viewerGmId)?.teamCode;
          if (!code) return { ok: false, reason: "You don't have a team." };
          if (released) store.releaseRookie(prospectId, code);
          else store.signRookie(prospectId, code);
          return { ok: true };
        },
        freeAgencyTurn: async (move) => store.freeAgencyTurn(move),
        draftCoach: async (coachId) => store.draftCoach(coachId),
        hireCoach: async (coachId) => store.hireCoach(coachId),
        readyUp: async (ready) => {
          store.setReady(store.viewerGmId, ready);
          return { ok: true };
        },
        forceAdvance: async () => ({ ok: false, reason: "Only an online league has a commissioner." }),
        refresh: async () => {},
      };
    }

    const after = async (result: ActionResult): Promise<ActionResult> => {
      if (result.ok) replaceState();
      return result;
    };

    return {
      online: true,
      signFreeAgent: (playerId, offer) =>
        attempt(() =>
          send((s) => s.client.signFreeAgent(s.leagueId, playerId, offer, s.version)),
        ).then(after),
      placeBid: (subject, targetId, offer) =>
        attempt(() =>
          send((s) => s.client.placeBid(s.leagueId, targetId, offer, s.version, subject)),
        ).then(after),
      proposeTrade: (toTeam, give, get) =>
        attempt(() =>
          send((s) => s.client.proposeTrade(s.leagueId, toTeam, give, get, s.version)),
        ).then(after),
      respondToTrade: (tradeId, accept) =>
        attempt(() =>
          send((s) => s.client.respondToTrade(s.leagueId, tradeId, accept, s.version)),
        ).then(after),
      makeDraftPick: (selectedId) =>
        attempt(() =>
          send((s) => s.client.makeDraftPick(s.leagueId, selectedId, s.version)),
        ).then(after),
      setDepthOrder: (position, playerIds) =>
        attempt(() => send((s) => s.client.setDepthOrder(s.leagueId, position, playerIds))).then(
          after,
        ),
      releasePlayer: (playerId) =>
        attempt(() => send((s) => s.client.releasePlayer(s.leagueId, playerId, s.version))).then(
          after,
        ),
      restructure: (playerId) =>
        attempt(() =>
          send((s) => s.client.contractMove(s.leagueId, playerId, { kind: "restructure" }, s.version)),
        ).then(after),
      extend: (playerId, terms) =>
        attempt(() =>
          send((s) =>
            s.client.contractMove(s.leagueId, playerId, { kind: "extend", ...terms }, s.version),
          ),
        ).then(after),
      settleRookie: (prospectId, released) =>
        attempt(() =>
          send((s) => s.client.settleRookie(s.leagueId, prospectId, released, s.version)),
        ).then(after),
      freeAgencyTurn: (move) =>
        attempt(() => send((s) => s.client.freeAgencyTurn(s.leagueId, move, s.version))).then(after),
      draftCoach: (coachId) =>
        attempt(() => send((s) => s.client.draftCoach(s.leagueId, coachId, s.version))).then(after),
      hireCoach: (coachId) =>
        attempt(() => send((s) => s.client.hireCoach(s.leagueId, coachId, s.version))).then(after),
      readyUp: (ready) =>
        attempt(() => send((s) => s.client.readyUp(s.leagueId, ready))).then(after),
      forceAdvance: () =>
        attempt(() => send((s) => s.client.forceAdvance(s.leagueId))).then(after),
      refresh: async () => {
        replaceState();
      },
    };
  }, [online, store, replaceState]);
}

/**
 * Keep the store in step with the server while a tab is open.
 *
 * Mount this once, high up. Everything below it goes on reading the store
 * exactly as it does in a single-player game and simply finds the league
 * already changed — which is the behaviour worth having, because the
 * alternative is a GM reasoning about a roster that was traded away ten
 * minutes ago.
 */
export function useOnlineSync(): void {
  useEffect(
    () =>
      onLeagueChange((state) => {
        useStore.setState(state as never);
      }),
    [],
  );
}

/** Team code the caller is playing as, either way. */
export function useMyTeamCode(): string | undefined {
  const gms = useStore((s) => s.gms);
  const viewerGmId = useStore((s) => s.viewerGmId);
  return onlineSession()?.teamCode ?? gms.find((g) => g.id === viewerGmId)?.teamCode;
}
