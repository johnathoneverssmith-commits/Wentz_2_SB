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
import type { ContractOffer, LeagueConfig, LeagueState, Position } from "@/domain";

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

export class OnlineLeagueClient {
  constructor(private readonly baseUrl = import.meta.env.VITE_LEAGUE_API ?? "http://localhost:8788") {}

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: body === undefined ? "GET" : "POST",
      // the session is an HttpOnly cookie, so it rides along rather than
      // being read and re-sent by script
      credentials: "include",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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

  readyUp = (leagueId: string, ready = true) =>
    this.call<{ moved: boolean; stage: string; autopiloted: string[] }>(
      `/leagues/${leagueId}/actions/ready`,
      { ready },
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
    const source = new EventSource(`${this.baseUrl}/leagues/${leagueId}/stream`, {
      withCredentials: true,
    });
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
    source.addEventListener("change", parse(on.change) as EventListener);
    source.addEventListener(
      "hello",
      parse(((h: { version: string }) => on.open?.(h.version)) as never) as EventListener,
    );
    if (on.error) source.addEventListener("error", () => on.error?.());
    return () => source.close();
  }

  /** Commissioner only: move the league on now. */
  forceAdvance = (leagueId: string) =>
    this.call<{ moved: boolean; stage: string; autopiloted: string[] }>(
      `/leagues/${leagueId}/admin/advance`,
      {},
    );
}
