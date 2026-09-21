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
