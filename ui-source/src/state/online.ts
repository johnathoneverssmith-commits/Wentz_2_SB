/**
 * Online mode, as a switch the rest of the app doesn't have to know about.
 *
 * The screens are the interesting part of this design: there are twenty of
 * them and none needed changing. They read `LeagueState` and call store
 * actions, and both of those mean the same thing online — the state is the
 * same object, it just arrives from a server instead of being computed
 * locally, and an action becomes a request instead of a local mutation.
 *
 * So the switch lives here, under the actions, rather than in the screens
 * above them. `isOnline()` is false and this file is inert for a local game.
 *
 * The one thing that genuinely differs is *when* a refusal arrives. Locally
 * a cap check fails instantly and synchronously. Online it fails after a
 * round trip, against a league that may have moved since the page loaded —
 * which is the honest answer, and why the actions that spend money return a
 * promise and the screens already show the reason they come back with.
 */
import type { LeagueState } from "@/domain";
import { OnlineError, OnlineLeagueClient } from "@/sim/OnlineLeagueClient";

interface OnlineSession {
  client: OnlineLeagueClient;
  leagueId: string;
  /** The concurrency token from the last load; sent with anything that spends. */
  version: string;
  teamCode: string;
  gmId: string;
  isCommissioner: boolean;
  msLeft: number | null;
  waitingOn: string[];
}

let session: OnlineSession | null = null;

/** Watchers that want to know when online mode comes or goes. */
const listeners = new Set<() => void>();
const announce = (): void => {
  for (const fn of listeners) fn();
};

export function onOnlineChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function isOnline(): boolean {
  return session !== null;
}

export function onlineSession(): OnlineSession | null {
  return session;
}

export function goLocal(): void {
  session = null;
  announce();
}

/**
 * Enter online mode for one league.
 *
 * Returns the league so the caller can put it in the store; it does not write
 * the store itself, because the store is where `set` lives and this module
 * deliberately doesn't import it (that way lies a cycle).
 */
export async function joinLeague(
  leagueId: string,
  baseUrl?: string,
): Promise<{ state: LeagueState; teamCode: string }> {
  const client = new OnlineLeagueClient(baseUrl);
  const view = await client.load(leagueId);
  if (!view.you) {
    throw new OnlineError("You don't have a team in this league yet.", 403);
  }
  session = {
    client,
    leagueId,
    version: view.version,
    teamCode: view.you.teamCode,
    gmId: view.you.gmId,
    isCommissioner: view.isCommissioner,
    msLeft: view.msLeft,
    waitingOn: view.waitingOn,
  };
  announce();
  return { state: view.state, teamCode: view.you.teamCode };
}

/** Fetch the league again. The server's copy always wins. */
export async function pull(): Promise<LeagueState | null> {
  if (!session) return null;
  const view = await session.client.load(session.leagueId);
  session.version = view.version;
  session.msLeft = view.msLeft;
  session.waitingOn = view.waitingOn;
  session.isCommissioner = view.isCommissioner;
  announce();
  return view.state;
}

/**
 * Send one action, then take back whatever the league now is.
 *
 * Replacing wholesale rather than applying optimistically is deliberate. An
 * optimistic apply needs a local rollback for every rule the server might
 * invoke, which means a second implementation of the rules and two chances
 * for them to disagree — the exact bug class this whole design exists to
 * avoid. These are one round trip on a human timescale; waiting is honest.
 */
export async function send<T>(
  act: (s: OnlineSession) => Promise<T>,
): Promise<{ result: T; state: LeagueState | null }> {
  if (!session) throw new OnlineError("Not in an online league.", 400);
  const result = await act(session);
  return { result, state: await pull() };
}

/** Milliseconds until this phase closes without you, for the countdown. */
export function phaseMsLeft(): number | null {
  return session?.msLeft ?? null;
}

export { OnlineError };
