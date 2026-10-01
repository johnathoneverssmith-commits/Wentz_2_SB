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
import { useNavigate } from "react-router-dom";

import type { ContractOffer, LeagueConfig, Position } from "@/domain";

import { isOnline, lastLeagueId, onLeagueChange, OnlineError, onlineSession, pull, send } from "./online.ts";
import { useStore } from "./store.ts";
import { OnlineUnansweredError } from "../sim/OnlineLeagueClient.ts";
import type { TrainingCampPlan } from "./trainingCamp.ts";
import type { DeadlineMove } from "./tradeDeadline.ts";
import { reconcileCpuTeam } from "./reconciliation.ts";
import { viewerTeamCode } from "./selectors.ts";

export interface ActionResult {
  ok: boolean;
  reason?: string;
  /**
   * True when the request itself never got a definite answer from the
   * server — a dropped connection, a timeout, a tab that lost focus mid
   * request — as opposed to the server answering "no" outright. Finding 17:
   * the two used to look identical (a refusal with a message), which is
   * dangerous to retry blindly and confusing to leave alone, since the
   * action may well have gone through. `attempt` always reconciles with the
   * server before returning either kind, so `state` reflects the truth by
   * the time a screen reads `ok` — the flag is only for deciding what to
   * *tell the player* about why this attempt reads as a refusal.
   */
  pending?: boolean;
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
  /** Take back an offer of yours that nobody has answered. */
  withdrawTrade: (tradeId: string) => Promise<ActionResult>;
  makeDraftPick: (selectedId: string) => Promise<ActionResult>;
  setDepthOrder: (position: Position, playerIds: string[]) => Promise<ActionResult>;
  /** Several positions' depth orders, fetching the league once at the end (online). */
  setDepthOrders: (orders: { position: Position; playerIds: string[] }[]) => Promise<ActionResult>;
  releasePlayer: (playerId: string) => Promise<ActionResult>;
  restructure: (playerId: string) => Promise<ActionResult>;
  extend: (
    playerId: string,
    terms: { baseSalary: number; years: number; guaranteed: number },
  ) => Promise<ActionResult>;
  /** Sign or release a rookie you drafted. */
  settleRookie: (prospectId: string, released: boolean) => Promise<ActionResult>;
  /**
   * Sign several rookies. Online they go out back to back and the league is
   * fetched once at the end — one download per rookie made "Sign all
   * remaining" take most of a minute on a slow host.
   */
  signRookies: (prospectIds: string[]) => Promise<ActionResult>;
  /** Release several players, fetching the league once at the end (online). */
  releasePlayers: (playerIds: string[]) => Promise<ActionResult>;
  /** At a free-agency summary: the staff cuts to legal and fills empty positions. */
  staffFix: () => Promise<ActionResult>;
  /** Reveal saved results through a week. Never simulates. */
  revealThrough: (through: number) => Promise<ActionResult>;
  /** Run this team's training camp. */
  submitTrainingCamp: (plan: TrainingCampPlan) => Promise<ActionResult>;
  /** Commit a hooded-figure payment (0 = decline) and resolve it immediately. */
  submitHoodedFigurePayment: (payment: number) => Promise<ActionResult>;
  deadlineTurn: (move: DeadlineMove) => Promise<ActionResult>;
  revealRound: () => Promise<ActionResult>;
  stepForward: (step: string) => Promise<ActionResult>;
  /** League settings before kickoff (online: commissioner only). */
  setConfig: (patch: Partial<LeagueConfig>) => Promise<ActionResult>;
  /** Star or unstar a draft prospect (private to this GM). */
  toggleDraftTarget: (prospectId: string) => Promise<ActionResult>;
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
  /** Commissioner: the GM holding a turn has their staff take it now. */
  takeTurnForAbsent: () => Promise<ActionResult>;
  /** Commissioner: hand a GM's team to the CPU and reopen the seat. */
  vacateSeat: (teamCode: string) => Promise<ActionResult>;
  /** Pull the server's copy and replace the local one. No-op offline. */
  refresh: () => Promise<void>;
}

/**
 * Turns a thrown error into the same shape a local refusal has — and, on
 * failure, always reconciles with the server first (finding 17).
 *
 * `OnlineError` means the request reached the server and got a definite
 * answer: a validation refusal, or the 409 the version check throws when the
 * league moved on first. Either way nothing was applied, and the server's
 * own sentence says why. Anything else — a dropped connection, a timeout, a
 * backgrounded tab — never got an answer at all, and the action may have
 * gone through anyway; that's `pending`, and the reconciling pull below is
 * what turns "I don't know" into an answer the screen can act on before it
 * ever shows the player anything.
 */
/**
 * When this device last checked the GM in. The last check-in moves the
 * league in the same response, so the device never sees itself "ready" —
 * and the app's "the league moved on without you" note fired on the GM's
 * own button press. Anything within a few seconds of this was them.
 */
let lastOwnCheckIn = 0;
export const checkedInJustNow = (): boolean => Date.now() - lastOwnCheckIn < 15_000;

/**
 * Apply the league `send` already fetched after the action. It used to be
 * thrown away and fetched again by `after` — two full league reads per
 * click, which on a slow server made "Sign all remaining" take a minute.
 */
function applyFetched(out: unknown): boolean {
  const state = (out as { state?: unknown } | null)?.state;
  if (!state) return false;
  useStore.setState(state as never);
  return true;
}

async function attempt(run: () => Promise<unknown>): Promise<ActionResult & { fresh?: boolean }> {
  let versionBefore = onlineSession()?.version;
  try {
    let out: unknown;
    try {
      out = await run();
    } catch (err) {
      // A 409 is the version check: the league changed since this screen
      // last loaded. Most of the time that change was somebody else's —
      // another GM readying up, a CPU pick — and has nothing to do with this
      // move, but it bounced a draft pick with "the league moved on" while
      // the player was plainly on the clock. Nothing was applied, and the
      // server re-checks the move itself (whose turn, still available, still
      // affordable), so refresh once and send it again; a second conflict,
      // or any real refusal, is reported as before.
      if (!(err instanceof OnlineError) || err.status !== 409) throw err;
      const fresh = await pull();
      if (fresh) useStore.setState(fresh as never);
      versionBefore = onlineSession()?.version;
      out = await run();
    }
    return { ok: true, fresh: applyFetched(out) };
  } catch (err) {
    const online = onlineSession();
    const state = await pull().catch(() => null);
    if (state) useStore.setState(state as never);

    if (err instanceof OnlineError) {
      return { ok: false, reason: err.message };
    }
    // an unanswered request: if the reconciling pull shows the league moved
    // since we last knew about it, the action most likely landed — the
    // player asked for something and, as far as this client can tell, got
    // it, so there's nothing left to retry.
    const landed = !!online && online.version !== versionBefore;
    return {
      ok: false,
      pending: true,
      // the refresh failed too: the server is unreachable, and this client
      // can't know whether the move landed — it used to claim "Nothing
      // changed — refreshed" when it had managed neither
      reason: !state
        ? "Couldn't reach the league server. If your move went through you'll see it when the connection is back; otherwise try again then."
        : landed
        ? "Lost the connection, but the league has moved since — this most likely went through. Refreshed to the current state."
        : // the client's own reason, when it has one ("the league server is
          // restarting") says more than a generic dropped connection
          err instanceof OnlineUnansweredError && /restarting/.test(err.message)
          ? `${err.message} Nothing changed.`
          : "Lost the connection before hearing back. Nothing changed — refreshed to the current state; try again.",
    };
  }
}

export function useLeagueActions(): LeagueActions {
  const navigate = useNavigate();
  const store = useStore();
  const online = isOnline();

  const replaceState = useCallback(async (): Promise<void> => {
    // the server's copy is the league; this is not a merge
    const state = await pull().catch(() => null);
    if (state) useStore.setState(state as never);
  }, []);

  return useMemo<LeagueActions>(() => {
    // An online league remembered but not connected: every move here would
    // land on a private copy the other GMs never see, and be thrown away on
    // the next load. Refuse them all, with the reason, until it reconnects.
    if (!online && lastLeagueId() !== null) {
      const refuse = async (): Promise<ActionResult> => ({
        ok: false,
        reason: "You're not connected to your online league — nothing here would reach it. Reconnect first.",
      });
      return new Proxy({ online: false } as LeagueActions, {
        get: (_target, key) => (key === "online" ? false : key === "refresh" ? async () => {} : refuse),
      }) as LeagueActions;
    }
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
        withdrawTrade: async (tradeId) => {
          useStore.setState((st) => {
            const t = st.trades.find((x) => x.id === tradeId);
            if (t && t.status === "offered") t.status = "withdrawn";
          });
          return { ok: true };
        },
        makeDraftPick: async (selectedId) => {
          store.makePick(selectedId);
          return { ok: true };
        },
        setDepthOrder: async (position, playerIds) => {
          const code = store.gms.find((g) => g.id === store.viewerGmId)?.teamCode;
          if (code) store.setDepthOrder(code, position, playerIds);
          return { ok: true };
        },
        setDepthOrders: async (orders) => {
          const code = store.gms.find((g) => g.id === store.viewerGmId)?.teamCode;
          if (code) for (const o of orders) store.setDepthOrder(code, o.position, o.playerIds);
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
        signRookies: async (prospectIds) => {
          const code = store.gms.find((g) => g.id === store.viewerGmId)?.teamCode;
          if (!code) return { ok: false, reason: "You don't have a team." };
          for (const id of prospectIds) store.signRookie(id, code);
          return { ok: true };
        },
        releasePlayers: async (playerIds) => {
          for (const id of playerIds) store.releasePlayer(id);
          return { ok: true };
        },
        staffFix: async () => {
          const code = viewerTeamCode(store);
          if (!code) return { ok: false, reason: "No team selected." };
          useStore.setState((d) => {
            reconcileCpuTeam(d as never, code);
          });
          return { ok: true };
        },
        revealThrough: async (through) => store.revealThrough(through),
        submitTrainingCamp: async (plan) => store.submitTrainingCamp(plan),
        submitHoodedFigurePayment: async (payment) => store.submitHoodedFigurePayment(payment),
        deadlineTurn: async (move) => store.deadlineTurn(move),
        revealRound: async () => store.revealRound(),
        stepForward: async (step) => store.stepForward(step),
        setConfig: async (patch) => {
          store.setConfig(patch);
          return { ok: true };
        },
        toggleDraftTarget: async (prospectId) => {
          store.toggleDraftTarget(store.viewerGmId, prospectId);
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
        takeTurnForAbsent: async () => ({ ok: false, reason: "Only an online league has a commissioner." }),
        vacateSeat: async () => ({ ok: false, reason: "Only an online league has a commissioner." }),
        refresh: async () => {},
      };
    }

    // Awaited: callers read the store the moment this resolves — the
    // readiness gate compares stages to decide whether to take the GM to
    // the next screen. Fire-and-forget left it reading the old stage, so
    // "Advance to Re-order Depth Chart" moved the league and left the GM
    // on the camp results (finding 4, again).
    const after = async (result: ActionResult & { fresh?: boolean }): Promise<ActionResult> => {
      if (result.ok && !result.fresh) await replaceState();
      const { fresh: _fresh, ...rest } = result;
      return rest;
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
      withdrawTrade: (tradeId) =>
        attempt(() => send((s) => s.client.withdrawTrade(s.leagueId, tradeId))).then(after),
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
      setDepthOrders: (orders) =>
        attempt(() =>
          send(async (s) => {
            await s.client.setDepthOrders(s.leagueId, orders);
            return null;
          }),
        ).then(after),
      releasePlayer: (playerId) =>
        attempt(() => send((s) => s.client.releasePlayer(s.leagueId, playerId, s.version))).then(
          after,
        ),
      staffFix: () => attempt(() => send((s) => s.client.staffFix(s.leagueId))).then(after),
      releasePlayers: (playerIds) =>
        attempt(() =>
          send(async (s) => {
            // one commit for the lot: the league reloads once, not per player
            await s.client.releasePlayers(s.leagueId, playerIds);
            return null;
          }),
        ).then(after),
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
      signRookies: (prospectIds) =>
        attempt(() =>
          send(async (s) => {
            // one commit for the class: seven signings were seven league reloads
            await s.client.settleRookies(s.leagueId, prospectIds, false);
            return null;
          }),
        ).then(after),
      revealThrough: (through) =>
        attempt(() => send((s) => s.client.revealThrough(s.leagueId, through, s.version))).then(after),
      submitTrainingCamp: (plan) =>
        attempt(() =>
          send((s) => s.client.submitTrainingCamp(s.leagueId, plan, s.version)),
        ).then(after),
      submitHoodedFigurePayment: (payment) =>
        attempt(() =>
          send((s) => s.client.submitHoodedFigurePayment(s.leagueId, payment, s.version)),
        ).then(after),
      deadlineTurn: (move) =>
        attempt(() => send((s) => s.client.deadlineTurn(s.leagueId, move, s.version))).then(after),
      revealRound: () =>
        attempt(() => send((s) => s.client.revealRound(s.leagueId, s.version))).then(after),
      setConfig: (patch) => attempt(() => send((s) => s.client.updateConfig(s.leagueId, patch))).then(after),
      toggleDraftTarget: (prospectId) =>
        attempt(() => send((s) => s.client.toggleDraftTarget(s.leagueId, prospectId))).then(after),
      stepForward: (step) =>
        attempt(() => send((s) => s.client.stepForward(s.leagueId, step, s.version))).then(after),
      freeAgencyTurn: (move) =>
        attempt(() => send((s) => s.client.freeAgencyTurn(s.leagueId, move, s.version))).then(after),
      draftCoach: (coachId) =>
        attempt(() => send((s) => s.client.draftCoach(s.leagueId, coachId, s.version))).then(after),
      hireCoach: (coachId) =>
        attempt(() => send((s) => s.client.hireCoach(s.leagueId, coachId, s.version))).then(after),
      readyUp: (ready) => {
        if (ready) lastOwnCheckIn = Date.now();
        // the stage on screen when pressed, captured now: by the time a
        // conflict retry resends it the store may already show the next one
        const stage = useStore.getState().stage;
        return attempt(() => send((s) => s.client.readyUp(s.leagueId, ready, stage)))
          .then(after)
          .then((res) => {
            // Finding 4, everywhere at once: when this press moved the league
            // (or found it already moved), go where it went. Several screens
            // wired their own advance button without it — the bracket's
            // "Advance to the Offseason" left the GM on the bracket.
            const next = useStore.getState().stage;
            if (next !== stage) {
              // leaving the playoffs: the awards splash first, which then
              // continues to the season screen
              navigate(stage === "playoffs" && next.startsWith("endOfSeason") ? "/end-of-season" : "/");
            }
            return res;
          });
      },
      forceAdvance: () =>
        attempt(() => send((s) => s.client.forceAdvance(s.leagueId))).then(after),
      takeTurnForAbsent: () =>
        attempt(() => send((s) => s.client.takeTurnForAbsent(s.leagueId))).then(after),
      vacateSeat: (teamCode) =>
        attempt(() => send((s) => s.client.vacateSeat(s.leagueId, teamCode))).then(after),
      // awaited, and allowed to fail: the checkpoint's backstop poll counts
      // failures to say when the server has gone quiet
      refresh: async () => {
        // a poll: most of the time nothing moved, and the answer is one row
        const state = await pull({ ifChanged: true });
        if (state) useStore.setState(state as never);
      },
    };
  }, [online, store, replaceState, navigate]);
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
