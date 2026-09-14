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
