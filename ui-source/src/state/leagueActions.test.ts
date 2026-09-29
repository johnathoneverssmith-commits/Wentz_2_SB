import { describe, expect, it, vi } from "vitest";

import { goLocal, isOnline } from "./online.ts";

/**
 * The seam, not the server.
 *
 * What matters here is that a screen written against `useLeagueActions` gets
 * the same shape either way — an async call that resolves `{ ok }` or
 * `{ ok: false, reason }` — so the same code can drive a local league or an
 * online one without knowing which it's in.
 */
describe("online mode", () => {
  it("is off until a league is joined", () => {
    goLocal();
    expect(isOnline()).toBe(false);
  });

  it("stays off when the join fails, rather than half-entering it", async () => {
    goLocal();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("no server"))),
    );
    try {
      const { joinLeague } = await import("./online.ts");
      await expect(joinLeague("nope")).rejects.toBeTruthy();
      expect(isOnline()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to join a league you have no team in", async () => {
    goLocal();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ state: {}, version: "1", you: null, waitingOn: [] }), {
            status: 200,
          }),
        ),
      ),
    );
    try {
      const { joinLeague } = await import("./online.ts");
      await expect(joinLeague("l1")).rejects.toThrow(/don't have a team/i);
      expect(isOnline()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sending while offline is an error, not a silent no-op", async () => {
    goLocal();
    const { send } = await import("./online.ts");
    await expect(send(async () => 1)).rejects.toThrow(/not in an online league/i);
  });
});

/**
 * The push channel, from the client's side.
 *
 * The server-side bookkeeping is `online/test/stream.test.ts`; what's left to
 * check here is the part that saves the bandwidth — that a frame announcing
 * a change this client already has doesn't send it back for the league.
 */
class FakeEventSource {
  static readonly CLOSED = 2;
  static last: FakeEventSource | null = null;
  static opened = 0;
  readyState = 0;
  readonly listeners = new Map<string, (ev: MessageEvent<string>) => void>();
  closed = false;
  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean },
  ) {
    FakeEventSource.last = this;
    FakeEventSource.opened += 1;
  }
  addEventListener(type: string, fn: (ev: MessageEvent<string>) => void): void {
    this.listeners.set(type, fn);
  }
  close(): void {
    this.closed = true;
  }
  /** Deliver one frame, the way the browser would. */
  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

const leagueView = (version: string) => ({
  league: { id: "l1", name: "Test" },
  state: { season: 2026, teams: {}, players: {} },
  version,
  you: { teamCode: "KC", gmId: "gm1" },
  isCommissioner: false,
  msLeft: null,
  waitingOn: [],
});

describe("the change stream", () => {
  it("pulls the league only when the pushed version is newer", async () => {
    goLocal();
    let version = "1";
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(leagueView(version)), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const { joinLeague, onLeagueChange, recentNews } = await import("./online.ts");
      await joinLeague("l1");
      const seen: unknown[] = [];
      onLeagueChange((s) => seen.push(s));

      const source = FakeEventSource.last!;
      expect(source.init?.withCredentials).toBe(true);
      const loads = fetchMock.mock.calls.length;

      // somebody else's action, but a version we already hold: news only
      source.emit("change", {
        version: "1",
        events: [{ id: "9", kind: "trade.offered", summary: "Buffalo offer a trade.", teamCode: "BUF", at: "now" }],
      });
      await Promise.resolve();
      expect(fetchMock.mock.calls.length).toBe(loads);
      expect(recentNews().map((e) => e.summary)).toEqual(["Buffalo offer a trade."]);

      // a version we don't hold: pull, and hand the league to the listeners
      version = "2";
      source.emit("change", { version: "2", events: [] });
      await vi.waitFor(() => expect(seen.length).toBe(1));
      expect(fetchMock.mock.calls.length).toBeGreaterThan(loads);
    } finally {
      goLocal();
      vi.unstubAllGlobals();
    }
  });

  it("catches up on a reconnect, and reopens a stream an error response closed", async () => {
    goLocal();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let version = "1";
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(leagueView(version)), { status: 200 })),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const { joinLeague, onLeagueChange } = await import("./online.ts");
      await joinLeague("l1");
      const seen: unknown[] = [];
      onLeagueChange((s) => seen.push(s));
      const first = FakeEventSource.last!;
      const loads = fetchMock.mock.calls.length;

      // the version we hold: nothing to fetch
      first.emit("hello", { version: "1" });
      await Promise.resolve();
      expect(fetchMock.mock.calls.length).toBe(loads);

      // back from a sleep, the server moved on without telling us
      version = "3";
      first.emit("hello", { version: "3" });
      await vi.waitFor(() => expect(seen.length).toBe(1));

      // a proxy's 502 closes the stream; it has to be reopened by hand
      const opened = FakeEventSource.opened;
      first.readyState = FakeEventSource.CLOSED;
      first.listeners.get("error")?.({} as MessageEvent<string>);
      vi.advanceTimersByTime(2_500);
      expect(FakeEventSource.opened).toBe(opened + 1);
      expect(FakeEventSource.last).not.toBe(first);
    } finally {
      goLocal();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("ends the session and says so when your seat is taken away", async () => {
    goLocal();
    let removed = false;
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        removed
          ? new Response(JSON.stringify({ error: "You're not in that league." }), { status: 403 })
          : new Response(JSON.stringify(leagueView("1")), { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const { joinLeague, pull, isOnline, takeRemoval, lastLeagueId } = await import("./online.ts");
      await joinLeague("l1");
      removed = true;
      await expect(pull()).rejects.toThrow(/not in that league/);
      expect(isOnline()).toBe(false);
      expect(lastLeagueId()).toBeNull();
      expect(takeRemoval()).toEqual({ league: "Test", why: "removed" });
      expect(takeRemoval()).toBeNull();
    } finally {
      goLocal();
      vi.unstubAllGlobals();
    }
  });

  it("switching leagues closes the old stream and clears its news", async () => {
    goLocal();
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(leagueView("1")), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const { joinLeague, recentNews } = await import("./online.ts");
      await joinLeague("l1");
      const first = FakeEventSource.last!;
      first.emit("change", { version: "1", events: [{ id: "7", kind: "x", summary: "DAL was claimed.", teamCode: null, at: "now" }] });
      await joinLeague("l2");
      expect(first.closed).toBe(true);
      expect(recentNews().some((e) => e.summary === "DAL was claimed.")).toBe(false);
    } finally {
      goLocal();
      vi.unstubAllGlobals();
    }
  });

  it("closes the stream and drops the news when you go back to a local game", async () => {
    goLocal();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(leagueView("1")), { status: 200 }))),
    );
    vi.stubGlobal("EventSource", FakeEventSource);
    try {
      const { joinLeague, recentNews } = await import("./online.ts");
      await joinLeague("l1");
      FakeEventSource.last!.emit("change", {
        version: "5",
        events: [{ id: "1", kind: "x", summary: "something", teamCode: null, at: "now" }],
      });
      goLocal();
      expect(FakeEventSource.last!.closed).toBe(true);
      expect(recentNews()).toHaveLength(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("survives a browser with no EventSource rather than failing to join", async () => {
    goLocal();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify(leagueView("1")), { status: 200 }))),
    );
    vi.stubGlobal("EventSource", undefined);
    try {
      const { joinLeague } = await import("./online.ts");
      await expect(joinLeague("l1")).resolves.toMatchObject({ teamCode: "KC" });
      expect(isOnline()).toBe(true);
    } finally {
      goLocal();
      vi.unstubAllGlobals();
    }
  });
});
