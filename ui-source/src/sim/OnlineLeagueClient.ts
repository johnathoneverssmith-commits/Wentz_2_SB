/**
 * The client's half of an online league.
 *
 * The single-player store computes the next state and keeps it. Online it
 * can't: eight people are changing the same league and only the server knows
 * what it currently is. So every mutating call here is "ask, then take what
 * comes back" — the response *is* the league, and the local copy is replaced
 * rather than reconciled.
 *
 * That's a deliberate choice over optimistic updates. An optimistic apply
 * would need a local rollback for every rule the server might invoke, which
 * means a second implementation of the rules and two chances to disagree.
 * The actions here are all one round trip on a human timescale — signing a
 * player, answering a trade — so the honest, simple thing is to wait.
 *
 * `version` is the concurrency token. It goes out with anything that spends
 * money or moves a player; the server refuses the write if the league has
 * moved on since, and the client is told to reload rather than silently
 * clobbering somebody.
 */
import type { ContractOffer, GameBroadcast, LeagueConfig, LeagueState, Position } from "@/domain";
import type { DeadlineMove } from "@/state/tradeDeadline";

export interface OnlineUser {
  id: string;
  name: string;
}

export interface LeagueView {
  league: { id: string; name: string };
  state: LeagueState;
  version: string;
  /** Null until you've claimed a team. */
  you: { teamCode: string; gmId: string } | null;
  isCommissioner: boolean;
  /** The league's invite code — commissioner only, null for everyone else. */
  inviteCode: string | null;
  /** Milliseconds until this phase closes without you, or null if untimed. */
  msLeft: number | null;
  /** Team codes the league is still waiting on. */
  waitingOn: string[];
}

export interface InboxItem {
  kind: "draft" | "trade" | "ready" | "roster";
  title: string;
  detail?: string;
  href: string;
  urgency: "now" | "soon" | "whenever";
}

export interface InboxLeague {
  leagueId: string;
  leagueName: string;
  teamCode: string;
  season: number;
  stage: string;
  msLeft: number | null;
  items: InboxItem[];
}

/** One push from the league's stream: what changed, in the league's own words. */
export interface StreamChange {
  version: string;
  events: { id: string; kind: string; summary: string; teamCode: string | null; at: string }[];
}

/** A refusal the server issued, with the sentence it wants shown. */
export class OnlineError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * A hung connection never rejects on its own — no response, no error, just
 * silence — and `fetch` has no default timeout. Finding 17: that's what left
 * the Online Leagues page reading "Looking for the league server…"
 * indefinitely, since `checking` only ever flips to `false` in the request's
 * own `finally`. A free-tier server can genuinely take up to a minute to wake
 * from cold, so this has to be generous rather than snappy.
 */
const REQUEST_TIMEOUT_MS = 45_000;
/**
 * Actions get longer. Readying up at a checkpoint simulates a block of
 * football on the server, which on a free-tier CPU can itself take half a
 * minute — abandoning it at 45s reported a failure for a transition that
 * went on to succeed.
 */
const ACTION_TIMEOUT_MS = 100_000;

/**
 * A request whose outcome is unknown: it timed out or the connection dropped
 * after it was sent, so the server may or may not have acted on it. Distinct
 * from `OnlineError`, which is the server saying no.
 */
export class OnlineUnansweredError extends Error {}

export class OnlineLeagueClient {
  constructor(private readonly baseUrl = import.meta.env.VITE_LEAGUE_API ?? "http://localhost:8788") {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      body === undefined ? REQUEST_TIMEOUT_MS : ACTION_TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        // the session is an HttpOnly cookie, so it rides along rather than
        // being read and re-sent by script
        credentials: "include",
        headers: body === undefined ? {} : { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new OnlineUnansweredError("The league server didn't answer in time.");
      }
      // a dropped connection: same uncertainty as a timeout
      throw new OnlineUnansweredError("Lost the connection to the league server.");
    } finally {
      clearTimeout(timeout);
    }
    const text = await res.text();
    const payload = text ? (JSON.parse(text) as { error?: string }) : {};
    if (!res.ok) {
      throw new OnlineError(payload.error ?? `Request failed (${res.status}).`, res.status);
    }
    return payload as T;
  }

  /* ---- accounts ------------------------------------------------------ */

  register = (name: string, password: string) =>
    this.call<{ user: OnlineUser }>("/auth/register", { name, password });
  login = (name: string, password: string) =>
    this.call<{ user: OnlineUser }>("/auth/login", { name, password });
  logout = () => this.call<{ ok: true }>("/auth/logout", {});
  /** Signs out every other device this account is signed in on. */
  changePassword = (current: string, password: string) =>
    this.call<{ ok: true }>("/auth/password", { current, password });
  /** A one-time code from the commissioner, for a GM who can't sign in. */
  resetPassword = (name: string, code: string, password: string) =>
    this.call<{ user: OnlineUser }>("/auth/reset", { name, code, password });
  /** Commissioner only: a reset code for the GM holding this team. */
  issueResetCode = (leagueId: string, teamCode: string) =>
    this.call<{ name: string; code: string }>(`/leagues/${leagueId}/admin/reset-code`, { teamCode });
  me = () => this.call<{ user: OnlineUser | null }>("/auth/me");

  /* ---- leagues ------------------------------------------------------- */

  myLeagues = () =>
    this.call<{
      leagues: {
        id: string;
        name: string;
        teamCode: string | null;
        stage: string;
        season: number;
        isCommissioner: boolean;
        /** Only ever set for the commissioner; it is the league's only door. */
        inviteCode: string | null;
      }[];
    }>("/leagues");

  createLeague = (input: {
    name: string;
    humanSlots?: number;
    phaseTimeoutHours?: number;
    /** The per-turn clock: a pick, a hire, a bid, a trade. */
    pickTimeoutHours?: number;
    /** League rules. The server merges these over its defaults. */
    config?: Partial<LeagueConfig>;
  }) => this.call<{ leagueId: string; inviteCode: string }>("/leagues", input);

  lookUpInvite = (code: string) =>
    this.call<{ league: { id: string; name: string }; openTeams: string[] }>(
      `/invites/${encodeURIComponent(code)}`,
    );

  /** Teams still free in a league you're already in (the invite lookup's twin). */
  openTeams = (leagueId: string) => this.call<{ openTeams: string[] }>(`/leagues/${leagueId}/teams`);

  settleRookie = (leagueId: string, prospectId: string, released: boolean, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/rookie`, {
      prospectId,
      released,
      version,
    });

  revealThrough = (leagueId: string, through: number, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/reveal`, {
      through,
      version,
    });

  /** Commissioner only, before the league starts. */
  updateConfig = (leagueId: string, patch: Partial<LeagueConfig>) =>
    this.call<{ ok: true }>(`/leagues/${leagueId}/admin/config`, { patch });

  toggleDraftTarget = (leagueId: string, prospectId: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/draft-target`, { prospectId });

  stepForward = (leagueId: string, step: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/step`, {
      step,
      version,
    });

  revealRound = (leagueId: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/reveal-round`, {
      version,
    });

  deadlineTurn = (leagueId: string, move: DeadlineMove, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/deadline`, {
      move,
      version,
    });

  submitTrainingCamp = (leagueId: string, plan: unknown, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/training-camp`, {
      plan,
      version,
    });

  submitHoodedFigurePayment = (leagueId: string, payment: number, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/hooded-figure`, {
      payment,
      version,
    });

  freeAgencyTurn = (
    leagueId: string,
    move: { playerId?: string; salary?: number; years?: number; pass?: boolean },
    version: string,
  ) => this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/fa-turn`, {
    ...move,
    version,
  });

  draftCoach = (leagueId: string, coachId: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/coach-draft`, {
      coachId,
      version,
    });

  hireCoach = (leagueId: string, coachId: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/coach`, {
      coachId,
      version,
    });

  claimTeam = (leagueId: string, teamCode: string) =>
    this.call<{ teamCode: string; gmId: string }>(`/leagues/${leagueId}/claim`, { teamCode });

  /** The whole league, as the server has it. This is the source of truth. */
  load = (leagueId: string) => this.call<LeagueView>(`/leagues/${leagueId}`);

  /**
   * The play-by-play for one revealed game, rebuilt server-side.
   *
   * Fetched on demand rather than carried in the league document: a
   * broadcast is ~44KB and the document travels whole on every pull, so
   * shipping them all would cost every GM six megabytes per request for
   * something opened a handful of times a season.
   */
  broadcast = (leagueId: string, gameId: string) =>
    this.call<{ broadcast: GameBroadcast }>(
      `/leagues/${leagueId}/games/${encodeURIComponent(gameId)}/broadcast`,
    );

  /** What's waiting on you, across every league you're in. */
  inbox = () => this.call<{ leagues: InboxLeague[] }>("/inbox");

  /** What happened while you were away. */
  feed = (leagueId: string, since = 0) =>
    this.call<{ events: { id: string; at: string; kind: string; summary: string; teamCode: string | null }[] }>(
      `/leagues/${leagueId}/feed?since=${since}`,
    );

  /* ---- actions ------------------------------------------------------- */

  signFreeAgent = (leagueId: string, playerId: string, offer: Omit<ContractOffer, "teamCode">, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/sign`, {
      playerId,
      offer,
      version,
    });

  placeBid = (
    leagueId: string,
    targetId: string,
    offer: Omit<ContractOffer, "teamCode">,
    version: string,
    subject: "players" | "coaches" = "players",
  ) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/bid`, {
      subject,
      targetId,
      offer,
      version,
    });

  proposeTrade = (leagueId: string, toTeam: string, give: string[], get: string[], version: string) =>
    this.call<{ ok: true; version: string; tradeId: string }>(
      `/leagues/${leagueId}/actions/trade/propose`,
      { toTeam, give, get, version },
    );

  respondToTrade = (leagueId: string, tradeId: string, accept: boolean, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/trade/respond`, {
      tradeId,
      accept,
      version,
    });

  makeDraftPick = (leagueId: string, selectedId: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/draft/pick`, {
      selectedId,
      version,
    });

  setDepthOrder = (leagueId: string, position: Position, playerIds: string[]) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/depth`, {
      position,
      playerIds,
    });

  releasePlayer = (leagueId: string, playerId: string, version: string) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/release`, {
      playerId,
      version,
    });

  contractMove = (
    leagueId: string,
    playerId: string,
    move: { kind: "restructure" } | { kind: "extend"; baseSalary: number; years: number; guaranteed: number },
    version: string,
  ) =>
    this.call<{ ok: true; version: string }>(`/leagues/${leagueId}/actions/contract`, {
      playerId,
      move,
      version,
    });

  /** `stage` is the one on screen: the server ignores a ready for a stage the league has left. */
  readyUp = (leagueId: string, ready = true, stage?: string) =>
    this.call<{ moved: boolean; stage: string; autopiloted: string[] }>(
      `/leagues/${leagueId}/actions/ready`,
      { ready, stage },
    );

  simulateWeek = (leagueId: string) =>
    this.call<{ played: boolean; reason: string | null; week: number; results: number }>(
      `/leagues/${leagueId}/actions/simulate-week`,
      {},
    );

  /**
   * Hold the league's stream open and hear about changes as they land.
   *
   * The frames are small — a version and the one-line summaries of what
   * happened — so this is a notification channel, not a replication one. Act
   * on a change by calling `load` again; the point of the stream is that you
   * only do that when there's something to load.
   *
   * `EventSource` reconnects on its own, which is most of why it's worth
   * using over a socket for something this one-directional. Returns a close
   * function; environments without `EventSource` (a test, a server render)
   * get a no-op rather than an exception, and fall back to whatever polling
   * the caller already does.
   */
  watch(
    leagueId: string,
    on: {
      change?: (news: StreamChange) => void;
      open?: (version: string) => void;
      error?: () => void;
    },
  ): () => void {
    if (typeof EventSource === "undefined") return () => {};
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let wait = 2_000;
    const parse =
      (fn: ((news: never) => void) | undefined) =>
      (ev: MessageEvent<string>): void => {
        if (!fn) return;
        try {
          fn(JSON.parse(ev.data) as never);
        } catch {
          // a malformed frame is not worth tearing the stream down for
        }
      };
    const connect = (): void => {
      if (closed) return;
      const s = new EventSource(`${this.baseUrl}/leagues/${leagueId}/stream`, { withCredentials: true });
      source = s;
      s.addEventListener("change", parse(on.change) as EventListener);
      s.addEventListener(
        "hello",
        parse(((h: { version: string }) => {
          wait = 2_000;
          on.open?.(h.version);
        }) as never) as EventListener,
      );
      s.addEventListener("error", () => {
        on.error?.();
        // A dropped connection retries by itself. An error *response* — a
        // proxy's 502 while the server restarts for a deploy — closes the
        // stream for good, and the league would go quiet until a reload.
        if (s.readyState === EventSource.CLOSED && !closed) {
          retry = setTimeout(connect, wait);
          wait = Math.min(wait * 2, 60_000);
        }
      });
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }

  /** Give up your seat: the CPU runs the team until someone claims it. */
  leaveLeague = (leagueId: string) => this.call<{ ok: true }>(`/leagues/${leagueId}/leave`, {});
  /** Commissioner only: the league leaves every lobby. */
  archiveLeague = (leagueId: string) => this.call<{ ok: true }>(`/leagues/${leagueId}/admin/archive`, {});

  /** Commissioner only: the CPU takes this GM's team and the seat reopens. */
  vacateSeat = (leagueId: string, teamCode: string) =>
    this.call<{ ok: true }>(`/leagues/${leagueId}/admin/vacate`, { teamCode });

  /** Commissioner only: move the league on now. */
  forceAdvance = (leagueId: string) =>
    this.call<{ moved: boolean; stage: string; autopiloted: string[] }>(
      `/leagues/${leagueId}/admin/advance`,
      {},
    );
}
