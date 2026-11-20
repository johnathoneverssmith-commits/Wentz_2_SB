import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineLoadError } from "@/sim/engineWorker/errors";
import { HybridSimulationService } from "@/sim/HybridSimulationService";
import { confirmEngineUpgrade, onEngineIssue, onEngineUpgrade, type EngineUpgrade, useStore } from "./store.ts";

/**
 * A saved dynasty remembers which build of the browser engine it was played on. When the build now loading is a
 * different one, nothing is played until the player confirms; a dynasty with no recorded build gets the current one
 * recorded; a Mock dynasty never asks for the engine at all.
 */
const s = () => useStore.getState();
let upgrades: (EngineUpgrade | null)[];
let issues: (string | null)[];
let offs: (() => void)[];
let version: ReturnType<typeof vi.spyOn>;
let fetched: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  upgrades = [];
  issues = [];
  await s().newLeague(4242); // also drops any notice a previous test left
  offs = [onEngineUpgrade((u) => upgrades.push(u)), onEngineIssue((m) => issues.push(m))];
  useStore.setState({ stage: "regularSeason", week: 1 } as never);
  // the engine itself is down: any move that gets past the version check fails there, visibly
  fetched = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
  vi.stubGlobal("fetch", fetched);
  version = vi.spyOn(HybridSimulationService.prototype, "engineVersion").mockResolvedValue("B".repeat(64));
});
afterEach(() => {
  offs.forEach((f) => f());
  version.mockRestore();
  vi.unstubAllGlobals();
});

const snapshot = () => JSON.stringify({ w: s().week, st: s().stage, g: s().games, p: s().pendingGameDay, sc: s().schedule });
/** the game-day lock is let go a tick after a move ends; a person's next press is always later than that */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const reachedTheEngine = () => (issues.at(-1) ?? "").includes("isn't reachable");

describe("a dynasty played on another build of the engine", () => {
  beforeEach(() => useStore.setState({ simEngine: "engine", simEngineVersion: "A".repeat(64) } as never));

  it("holds the move: nothing is played or changed, the engine is not asked, and the notice says from what to what", async () => {
    const before = snapshot();
    const r = await s().simulateGameDay();
    expect(r.route).toBe("/hub");
    expect(snapshot()).toBe(before);
    expect(s().simEngineVersion).toBe("A".repeat(64));
    expect(fetched).not.toHaveBeenCalled();
    expect(upgrades.at(-1)).toEqual({ from: "A".repeat(64), to: "B".repeat(64) });
  });

  it("confirming records the new build once and lets the move through", async () => {
    await s().simulateGameDay();
    expect(confirmEngineUpgrade()).toBe(true);
    expect(s().simEngineVersion).toBe("B".repeat(64));
    expect(upgrades.at(-1)).toBeNull();
    expect(confirmEngineUpgrade()).toBe(false); // nothing left to confirm
    await settle();
    await s().simulateGameDay();
    expect(reachedTheEngine()).toBe(true); // past the version check, then the (stubbed) engine failed as usual
    expect(upgrades.filter((u) => u !== null)).toHaveLength(1); // asked once, not again
  });

  it("keeps asking until confirmed, and never asks about the same build twice", async () => {
    await s().simulateGameDay();
    await settle();
    await s().simulateGameDay();
    expect(upgrades.filter((u) => u !== null)).toHaveLength(1); // one notice, held
    expect(s().simEngineVersion).toBe("A".repeat(64));
  });

  it("fast-forward stops with the reason instead of finishing weeks that were never played", async () => {
    useStore.setState({ stage: "preseason", week: 1 } as never);
    const r = await s().fastForwardSeason();
    expect(r.ok).toBe(false);
    expect(r.weeksPlayed).toBe(0);
    expect(r.reason).toMatch(/engine has been updated/);
  });

  it("starting another dynasty drops the hold", async () => {
    await s().simulateGameDay();
    expect(upgrades.at(-1)).not.toBeNull();
    await s().newLeague(99);
    expect(upgrades.at(-1)).toBeNull();
  });
});

describe("a dynasty played on the same build, or on none recorded", () => {
  it("the same build goes straight to the engine", async () => {
    useStore.setState({ simEngine: "engine", simEngineVersion: "B".repeat(64) } as never);
    await s().simulateGameDay();
    expect(reachedTheEngine()).toBe(true);
    expect(upgrades.filter((u) => u !== null)).toEqual([]);
  });

  it("no recorded build (an older save): the current one is recorded and the move goes ahead, with no question", async () => {
    useStore.setState({ simEngine: "engine", simEngineVersion: undefined } as never);
    await s().simulateGameDay();
    expect(s().simEngineVersion).toBe("B".repeat(64));
    expect(reachedTheEngine()).toBe(true);
    expect(upgrades.filter((u) => u !== null)).toEqual([]);
  });

  it("the local adapter can't name its engine: nothing is recorded or asked", async () => {
    version.mockResolvedValue(undefined);
    useStore.setState({ simEngine: "engine", simEngineVersion: undefined } as never);
    await s().simulateGameDay();
    expect(s().simEngineVersion).toBeUndefined();
    expect(reachedTheEngine()).toBe(true);
  });
});

describe("other dynasties and failures", () => {
  it("a Mock dynasty never asks which engine is loaded", async () => {
    useStore.setState({ simEngine: "mock", simEngineVersion: undefined } as never);
    await s().simulateGameDay();
    expect(version).not.toHaveBeenCalled();
    expect(s().simEngine).toBe("mock");
    expect(upgrades.filter((u) => u !== null)).toEqual([]);
  });

  it("an engine that can't start is the usual notice with its own advice; nothing changes and nothing is recorded", async () => {
    useStore.setState({ simEngine: "engine", simEngineVersion: "A".repeat(64) } as never);
    version.mockRejectedValue(new EngineLoadError("download", "The game engine couldn't be downloaded. Check your connection and press Retry.", true));
    const before = snapshot();
    await s().simulateGameDay();
    expect(snapshot()).toBe(before);
    expect(issues.at(-1)).toMatch(/couldn't be downloaded/);
    expect(issues.at(-1)).not.toMatch(/npm run server/);
    expect(s().simEngineVersion).toBe("A".repeat(64));
  });
});
