import { afterEach, describe, expect, it, vi } from "vitest";

import { OnlineLeagueClient } from "./OnlineLeagueClient.ts";

/**
 * Deployed multiplayer playtest finding 17: `fetch` has no default timeout,
 * so a connection that never answers — a half-woken free-tier server, a
 * network black hole — never rejected either, which is what left the Online
 * Leagues page reading "Looking for the league server…" forever (the
 * `checking` flag only ever flips in the request's own `finally`).
 */
describe("OnlineLeagueClient — request timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("rejects instead of hanging when nothing ever answers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new DOMException("Aborted", "AbortError");
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new OnlineLeagueClient("http://example.invalid");
    const promise = client.me();
    const assertion = expect(promise).rejects.toThrow(/didn't answer in time/);

    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it("resolves normally when the server answers before the timeout", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ user: { id: "u1", name: "Alice" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new OnlineLeagueClient("http://example.invalid");
    const res = await client.me();
    expect(res.user?.name).toBe("Alice");
  });
});

/**
 * MP-2 (audit D4, D7): the server refuses a ready or a force-advance that
 * doesn't name the stage it was made for, so the client must always send it.
 */
describe("OnlineLeagueClient — stage-guarded requests", () => {
  afterEach(() => vi.unstubAllGlobals());

  const capture = () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ moved: false, stage: "setup", autopiloted: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const bodyOf = (m: ReturnType<typeof capture>) => JSON.parse(String(m.mock.calls[0]![1]!.body));

  it("sends the stage on screen with a force-advance", async () => {
    const m = capture();
    await new OnlineLeagueClient("http://example.invalid").forceAdvance("L1", "fantasyDraft");
    expect(String(m.mock.calls[0]![0])).toContain("/leagues/L1/admin/advance");
    expect(bodyOf(m)).toEqual({ stage: "fantasyDraft" });
  });

  it("sends the stage with a ready", async () => {
    const m = capture();
    await new OnlineLeagueClient("http://example.invalid").readyUp("L1", true, "trainingCamp");
    expect(bodyOf(m)).toEqual({ ready: true, stage: "trainingCamp" });
  });
});
