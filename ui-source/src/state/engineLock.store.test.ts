import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onEngineIssue, retryEngine, useStore } from "./store.ts";

/**
 * The adapter-loss scenario from QA PR #106, at the store: an engine-backed dynasty that loses the adapter must stop
 * with a notice and an unchanged, saved state — not play on with the Mock — and must be able to continue once the
 * engine is back.
 */
const s = () => useStore.getState();
let issues: (string | null)[] = [];
let off: () => void;

beforeEach(async () => {
  issues = [];
  off = onEngineIssue((m) => issues.push(m));
  await s().newLeague(4242);
  useStore.setState({ stage: "regularSeason", week: 1 } as never);
});
afterEach(() => {
  off();
  vi.unstubAllGlobals();
});

describe("simulator is fixed per dynasty", () => {
  it("a dynasty built with no adapter is Mock-backed, plays, and never asks the adapter", async () => {
    expect(s().simEngine).toBe("mock");
    const f = vi.fn(() => Promise.reject(new TypeError("down")));
    vi.stubGlobal("fetch", f);
    await s().simulateGameDay();
    expect(s().pendingGameDay).not.toBeNull();
    expect(s().games.length).toBeGreaterThan(0);
    expect(f).not.toHaveBeenCalled();
    expect(issues.filter(Boolean)).toHaveLength(0);
  });

  it("adapter lost under an engine-backed dynasty: nothing is played, nothing changes, the notice appears", async () => {
    useStore.setState({ simEngine: "engine" } as never);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const before = JSON.stringify({ w: s().week, st: s().stage, g: s().games, p: s().pendingGameDay, t: s().teams });
    const r = await s().simulateGameDay();
    expect(r.route).toBe("/hub");
    expect(JSON.stringify({ w: s().week, st: s().stage, g: s().games, p: s().pendingGameDay, t: s().teams })).toBe(before);
    expect(s().simEngine).toBe("engine"); // still engine-backed: no switch
    expect(issues.at(-1)).toMatch(/engine isn't reachable/);
    // a second press retries for real (and fails the same safe way)
    await s().simulateGameDay();
    expect(s().games).toHaveLength(0);
  });

  it("fast-forward stops with the reason instead of finishing weeks that were never played", async () => {
    useStore.setState({ simEngine: "engine", stage: "preseason", week: 1 } as never);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const r = await s().fastForwardSeason();
    expect(r.ok).toBe(false);
    expect(r.weeksPlayed).toBe(0);
    expect(r.reason).toMatch(/engine isn't reachable/);
    expect(s().week).toBe(1);
    expect(s().games).toHaveLength(0);
  });

  it("Retry reports the engine back only when it answers, and clears the notice", async () => {
    useStore.setState({ simEngine: "engine" } as never);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    await s().simulateGameDay();
    expect(issues.at(-1)).toBeTruthy();
    expect(await retryEngine()).toBe(false);
    expect(issues.at(-1)).toBeTruthy();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ baseline: { off: {}, def: {} } }), { status: 200, headers: { "content-type": "application/json" } }))));
    expect(await retryEngine()).toBe(true);
    expect(issues.at(-1)).toBeNull();
  });

  it("engine-backed rollover and bracket seeding also stop safely (the other two places the engine is called)", async () => {
    useStore.setState({ simEngine: "engine", stage: "regularSeason", week: 18 } as never);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const before = JSON.stringify({ st: s().stage, b: s().bracket, w: s().week });
    const r = await s().finishGameDay();
    expect(r.route).toBeTruthy();
    expect(JSON.stringify({ st: s().stage, b: s().bracket, w: s().week })).toBe(before);
  });
});
