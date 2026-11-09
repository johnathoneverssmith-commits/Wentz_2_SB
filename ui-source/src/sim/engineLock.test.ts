import { afterEach, describe, expect, it, vi } from "vitest";

import type { LeagueState } from "@/domain";

import { EngineUnavailableError, engineOf, isEngineUnavailable } from "./engineMode.ts";
import { HybridSimulationService } from "./HybridSimulationService.ts";

/**
 * #74 / TAFI-GAP-004: a dynasty must never silently change simulator. QA PR #106 killed the adapter under an
 * engine-built dynasty and the same save played a whole season on the Mock, with 1-point scores and no stored
 * playoff games. The simulator is now fixed per save (`simEngine`): engine -> adapter or an error, mock -> never the adapter.
 */
const down = () => vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
const slate = [{ week: 1, phase: "REG" as const, homeTeam: "KC", awayTeam: "BUF" }];
const league = (extra: Partial<LeagueState>): LeagueState =>
  ({ season: 2027, stage: "regularSeason", week: 1, schedule: slate, games: [], teams: {}, players: {}, gms: [], viewerGmId: "g", config: {}, ...extra }) as unknown as LeagueState;

afterEach(() => vi.unstubAllGlobals());

describe("engine-backed dynasty", () => {
  it("refuses to simulate when the adapter is down (no Mock fallback), and asks again on every retry", async () => {
    const f = down();
    vi.stubGlobal("fetch", f);
    const sim = new HybridSimulationService();
    const state = league({ simEngine: "engine" });
    await expect(sim.simulateWeek(state, 1, "REG")).rejects.toBeInstanceOf(EngineUnavailableError);
    const afterFirst = f.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);
    // the 30 s cooldown that spares the console in standalone use must not make Retry a no-op
    await expect(sim.simulateWeek(state, 1, "REG")).rejects.toSatisfy(isEngineUnavailable);
    expect(f.mock.calls.length).toBeGreaterThan(afterFirst);
  });

  it("refuses playoff seeding, a playoff round and next season's schedule too", async () => {
    vi.stubGlobal("fetch", down());
    const sim = new HybridSimulationService();
    const state = league({ simEngine: "engine", bracket: { currentRound: "WC", seeds: { AFC: [], NFC: [] }, matchups: [], champion: null } });
    await expect(sim.seedBracket(state)).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(sim.simulatePlayoffRound(state, "WC")).rejects.toBeInstanceOf(EngineUnavailableError);
    await expect(sim.generateSchedule(2028, ["KC", "BUF"], "engine")).rejects.toBeInstanceOf(EngineUnavailableError);
  });

  it("an old save with engine-stamped games (weather) is inferred to be engine-backed", async () => {
    vi.stubGlobal("fetch", down());
    const sim = new HybridSimulationService();
    const old = league({ games: [{ id: "g1", week: 1, phase: "REG", homeTeam: "KC", awayTeam: "BUF", played: true, homeScore: 20, awayScore: 17, weather: "Indoors" }] });
    expect(engineOf(old)).toBe("engine");
    await expect(sim.simulateWeek(old, 1, "REG")).rejects.toBeInstanceOf(EngineUnavailableError);
  });
});

describe("mock-backed dynasty", () => {
  it("never calls the adapter, even when it is up (a Mock dynasty cannot turn into an engine one)", async () => {
    const f = vi.fn(() => Promise.resolve(new Response("{}", { status: 200 })));
    vi.stubGlobal("fetch", f);
    const sim = new HybridSimulationService();
    const s = league({ simEngine: "mock" });
    const games = await sim.simulateWeek(s, 1, "REG");
    expect(games).toHaveLength(1);
    expect(f).not.toHaveBeenCalled();
    expect(sim.lastSource).toBe("mock");
  });

  it("an old save whose games have no weather is inferred to be Mock-backed", () => {
    const old = league({ games: [{ id: "g1", week: 1, phase: "REG", homeTeam: "KC", awayTeam: "BUF", played: true, homeScore: 20, awayScore: 17 }] });
    expect(engineOf(old)).toBe("mock");
  });
});

describe("undecided (new, or an old save that has played nothing)", () => {
  it("standalone: no adapter -> Mock, and says so, so the caller can fix the choice", async () => {
    vi.stubGlobal("fetch", down());
    const sim = new HybridSimulationService();
    expect(engineOf(league({}))).toBeUndefined();
    const games = await sim.simulateWeek(league({}), 1, "REG");
    expect(games).toHaveLength(1);
    expect(sim.lastSource).toBe("mock");
    expect((await sim.generateSchedule(2026, ["KC", "BUF"])).length).toBeGreaterThan(0);
    expect(sim.sourceOf("schedule")).toBe("mock");
  });

  it("an explicit simEngine always wins over inference", () => {
    const s = league({ simEngine: "mock", games: [{ id: "g1", week: 1, phase: "REG", homeTeam: "KC", awayTeam: "BUF", played: true, homeScore: 20, awayScore: 17, weather: "Indoors" }] });
    expect(engineOf(s)).toBe("mock");
  });
});

describe("labels the store relies on to fix a new dynasty's simulator", () => {
  it("an answering adapter is recorded as 'engine' for the schedule (and an unreachable one as 'mock')", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify([{ week: 1, phase: "REG", homeTeam: "KC", awayTeam: "BUF" }]), { status: 200, headers: { "content-type": "application/json" } }))));
    const up = new HybridSimulationService();
    expect((await up.generateSchedule(2026, ["KC", "BUF"])).some((g) => g.phase === "REG")).toBe(true);
    expect(up.sourceOf("schedule")).toBe("engine");
    expect(up.lastSource).toBe("engine");
    vi.stubGlobal("fetch", down());
    const dn = new HybridSimulationService();
    await dn.generateSchedule(2026, ["KC", "BUF"]);
    expect(dn.sourceOf("schedule")).toBe("mock");
  });
});
