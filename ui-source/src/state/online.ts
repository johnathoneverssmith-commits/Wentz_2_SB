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
import type { GameBroadcast, LeagueState } from "@/domain";
import { OnlineError, OnlineLeagueClient, type StreamChange } from "@/sim/OnlineLeagueClient";

interface OnlineSession {
  client: OnlineLeagueClient;
  leagueId: string;
  /** The concurrency token from the last load; sent with anything that spends. */
  version: string;
  teamCode: string;
  gmId: string;
  isCommissioner: boolean;
  inviteCode: string | null;
  /** The league's name, for the rail: a GM in two leagues couldn't tell which was open. */
  leagueName: string;
  msLeft: number | null;
  /** When `msLeft` runs out, by this device's clock — so a countdown can tick between loads. */
  phaseEndsAt: number | null;
  waitingOn: string[];
  /** Closes the change stream. Null when nothing is listening. */
  stopWatching: (() => void) | null;
}

let session: OnlineSession | null = null;

/**
 * Say which GM the person at this keyboard is.
 *
 * The server's league is written from nobody's point of view — it has to be,
 * since every GM in it loads the same document. `viewerGmId` is the one field
 * that is about the reader rather than the league, and it arrives holding
 * whatever the seed put there: `gm_you`, a slot that in an online league is
 * just another unclaimed team. So the whole app asked "who am I" and got back
 * an empty slot, and every screen that keys off the viewer — starting with
 * the team hub — decided you had no team, no matter which one you had
 * claimed.
 *
 * Stamping it here means every path is covered at once: the first load, the
 * stream's refetch, and the state that comes back from an action.
 */
function asViewer(state: LeagueState, gmId: string): LeagueState {
  return state.viewerGmId === gmId ? state : { ...state, viewerGmId: gmId };
}

/**
 * The league's own words for what just happened, newest last, capped.
 *
 * Kept here rather than in the store because it is news *about* the league
 * rather than part of it — it must survive a state replacement, and it means
 * nothing in a single-player game.
 */
const news: StreamChange["events"] = [];
const NEWS_KEPT = 50;

export function recentNews(): readonly StreamChange["events"][number][] {
  return news;
}

/** Watchers that want the new league after the stream said it moved. */
const stateListeners = new Set<(state: LeagueState) => void>();

export function onLeagueChange(fn: (state: LeagueState) => void): () => void {
  stateListeners.add(fn);
  return () => stateListeners.delete(fn);
}

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

/** The league this browser was just put out of, and why — for the notice. Cleared once read. */
export interface Removal {
  league: string;
  why: "removed" | "signedOut";
}
let removedFrom: Removal | null = null;
export function takeRemoval(): Removal | null {
  const out = removedFrom;
  removedFrom = null;
  return out;
}

export function goLocal(): void {
  session?.stopWatching?.();
  session = null;
  news.length = 0;
  forgetLeague();
  announce();
}

/**
 * Which league this browser was last playing, across a reload.
 *
 * The league itself is persisted by the store, but the session that makes it
 * *online* lived only in this module — so a refresh left the server's league
 * sitting in local state with nothing connecting it to the server. Everything
 * still rendered, which is what made it dangerous: readying up, signing,
 * trading all quietly wrote to a private copy that no other GM would ever
 * see, and the screens said "solo dynasty" while showing a shared league.
 *
 * Only the id is kept. The league, the version and who you are all come back
 * from the server on the next load, which is the only copy that counts.
 */
const LAST_LEAGUE_KEY = "fs.online.leagueId";

function rememberLeague(leagueId: string): void {
  try {
    window.localStorage.setItem(LAST_LEAGUE_KEY, leagueId);
  } catch {
    // a browser that refuses storage just means no resume; not fatal
  }
}

function forgetLeague(): void {
  try {
    window.localStorage.removeItem(LAST_LEAGUE_KEY);
  } catch {
    /* nothing to do */
  }
}

export function lastLeagueId(): string | null {
  try {
    return window.localStorage.getItem(LAST_LEAGUE_KEY);
  } catch {
    return null;
  }
}

/**
 * Rejoin the league this browser was in, if it still has a session cookie.
 *
 * Failure is ordinary, not exceptional — signed out, league deleted, team
 * given away, server asleep — and in every one of those cases the right
 * answer is the same: stay local and say nothing. The caller learns whether
 * it worked from `isOnline()`.
 */
/** Why rejoining the last league didn't work, when it didn't. */
export type ResumeFailure = "signedOut" | "unreachable";

export async function resumeLeague(): Promise<LeagueState | ResumeFailure | null> {
  if (session) return null;
  const leagueId = lastLeagueId();
  if (!leagueId) return null;
  try {
    const { state } = await joinLeague(leagueId);
    return state;
  } catch (err) {
    // Don't forget the id on a transient failure — a sleeping free-tier
    // server would permanently demote the league to a local copy. The next
    // load tries again; `goLocal` is what actually clears it.
    //
    // But say which failure it was: an expired or revoked session read the
    // same as a sleeping server, and the GM went on playing a local copy
    // that nothing they did would ever reach.
    return err instanceof OnlineError && (err.status === 401 || err.status === 403) ? "signedOut" : "unreachable";
  }
}

/**
 * Hold the stream open and act on what it says.
 *
 * The version check is the whole point: the server pushes on every change,
 * including the ones this client just made, and pulling the league again
 * because of your own signing is a wasted megabyte. So a frame whose version
 * we already have updates the news ticker and stops there.
 */
/** Events that change only the acting GM's own view of the league. */
const PRIVATE_KINDS = new Set(["reveal", "step"]);

function watch(): void {
  if (!session) return;
  const s = session;
  let pulling = false;
  let pullAgain = false;
  // One pull at a time. A burst of changes (a CPU sweep, several GMs at
  // once) used to start a full download per frame, and on a slow link they
  // overlapped — each one the whole league.
  const refresh = (): void => {
    if (pulling) {
      pullAgain = true;
      return;
    }
    pulling = true;
    const run = (): void => {
      pullAgain = false;
      void pull()
        .then((state) => {
          if (!state) return;
          for (const fn of stateListeners) fn(state);
        })
        // a server blip mid-pull: the next frame (or the checkpoint's poll)
        // tries again, and an unhandled rejection helps nobody
        .catch(() => undefined)
        .finally(() => {
          if (session === s && pullAgain) run();
          else pulling = false;
        });
    };
    run();
  };
  s.stopWatching = s.client.watch(s.leagueId, {
    change: (change) => {
      if (session !== s) return;
      news.push(...change.events);
      if (news.length > NEWS_KEPT) news.splice(0, news.length - NEWS_KEPT);
      if (change.version === s.version) {
        announce();
        return;
      }
      // Another GM watching a week or moving between screens changes only
      // their own marker — nothing this screen shows — but every one of those
      // used to send every other GM to re-download the whole league. Only
      // when the change is nothing but that (a commit with no events at all
      // still pulls: some change the league without logging).
      if (
        change.events.length > 0 &&
        change.events.every((e) => PRIVATE_KINDS.has(e.kind) && e.teamCode !== s.teamCode)
      ) {
        s.version = change.version;
        announce();
        return;
      }
      refresh();
    },
    // Every (re)connect says which version the server is on. After a laptop
    // sleeps or the server restarts, the changes made meanwhile were never
    // sent — this is the only way to hear about them.
    open: (version) => {
      if (session === s && version !== s.version) refresh();
    },
    // A dropped connection reconnects by itself; nothing to do but stop
    // claiming the countdown is live. An error *response* is different: the
    // server may be saying you're no longer in the league, and one pull finds
    // out (and ends the session if so) where the stream never could.
    error: (closed) => {
      announce();
      if (closed && session === s) refresh();
    },
  });
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
    inviteCode: view.inviteCode,
    leagueName: view.league.name,
    msLeft: view.msLeft,
    phaseEndsAt: view.msLeft == null ? null : Date.now() + view.msLeft,
    waitingOn: view.waitingOn,
    stopWatching: null,
  };
  watch();
  rememberLeague(leagueId);
  announce();
  void seedNews(client, leagueId);
  return { state: asViewer(view.state, view.you.gmId), teamCode: view.you.teamCode };
}

/**
 * The wire starts with what happened before you arrived. Only the stream
 * filled it, so a GM opening the league saw nothing of the night's moves.
 */
async function seedNews(client: OnlineLeagueClient, leagueId: string): Promise<void> {
  const got = await client.feed(leagueId).catch(() => null);
  if (!got || !Array.isArray(got.events) || session?.leagueId !== leagueId) return;
  const have = new Set(news.map((e) => e.id));
  const older = got.events
    .filter((e) => !have.has(e.id))
    .reverse()
    .map((e) => ({ ...e, at: String(e.at) }));
  news.unshift(...older);
  if (news.length > NEWS_KEPT) news.splice(0, news.length - NEWS_KEPT);
  announce();
}

/** Fetch the league again. The server's copy always wins. */
export async function pull(opts: { ifChanged?: boolean } = {}): Promise<LeagueState | null> {
  const s = session;
  if (!s) return null;
  let got: Awaited<ReturnType<typeof s.client.loadIfChanged>>;
  try {
    got = opts.ifChanged ? await s.client.loadIfChanged(s.leagueId, s.version) : await s.client.load(s.leagueId);
  } catch (err) {
    // The seat was reopened, you left from another device, or the league was
    // archived: every move from here would fail with "you're not in that
    // league". End the session and say so, rather than leave a live-looking
    // league on screen.
    if (err instanceof OnlineError && (err.status === 403 || err.status === 404) && session === s) {
      removedFrom = { league: s.leagueName, why: "removed" };
      goLocal();
    } else if (err instanceof OnlineError && err.status === 401 && session === s) {
      // signed out (the session expired, or the password changed elsewhere):
      // keep the league remembered so signing back in picks it up again
      removedFrom = { league: s.leagueName, why: "signedOut" };
      const id = s.leagueId;
      goLocal();
      rememberLeague(id);
    }
    throw err;
  }
  if ("unchanged" in got) {
    if (session === s) {
      s.msLeft = got.msLeft;
      s.phaseEndsAt = got.msLeft == null ? null : Date.now() + got.msLeft;
      announce();
    }
    return null;
  }
  const view = got;
  // A session can end mid-flight — someone goes back to a local game, or
  // joins a different league — and writing this answer into whatever session
  // is current now would quietly cross the two leagues.
  if (session !== s) return null;
  // An older answer arriving after a newer one (two pulls in flight on a
  // slow link) would put the screen back a step; the newer one already won.
  if (Number(view.version) < Number(s.version)) return null;
  s.version = view.version;
  s.msLeft = view.msLeft;
  s.phaseEndsAt = view.msLeft == null ? null : Date.now() + view.msLeft;
  s.waitingOn = view.waitingOn;
  s.isCommissioner = view.isCommissioner;
  s.inviteCode = view.inviteCode;
  s.leagueName = view.league.name;
  announce();
  return asViewer(view.state, s.gmId);
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

/**
 * Fetch one game's play-by-play, or null when this is a local league.
 *
 * Offline the broadcast is already on the game — only the online block
 * throws it away, so only the online path has to ask for it back.
 */
export async function fetchBroadcast(gameId: string): Promise<GameBroadcast | null> {
  const s = session;
  if (!s) return null;
  const { broadcast } = await s.client.broadcast(s.leagueId, gameId);
  return broadcast;
}

/** Milliseconds until this phase closes without you, for the countdown. */
export function phaseMsLeft(): number | null {
  const ends = session?.phaseEndsAt;
  return ends == null ? null : Math.max(0, ends - Date.now());
}

export { OnlineError };
