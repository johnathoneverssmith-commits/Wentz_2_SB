import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Player } from "../src/schema/player.js";

/**
 * Issue #74 Phase 1 (D-020): the reference player pool is an explicit,
 * versioned engine input. The engine used to call `loadPlayerPool()` at run
 * time (through the centring offsets), so a result depended on which pool file
 * the host happened to have. Each case loads a fresh copy of the engine
 * (`vi.resetModules`) because the pool and everything derived from it is
 * module state.
 */
const FIXTURE = resolve("test/fixtures/pool.json");
const SAMPLE = resolve("data/players_sample.json");
const fixturePool = JSON.parse(readFileSync(FIXTURE, "utf8")) as Player[];
const SEEDS = [1, 7, 42, 101];

async function freshEngine(env: string | undefined, hooks?: { onRead?: (what: string) => void }) {
  vi.resetModules();
  if (env === undefined) delete process.env.NFL_POOL_PATH;
  else process.env.NFL_POOL_PATH = env;
  if (hooks?.onRead) {
    const onRead = hooks.onRead;
    vi.doMock("../src/data/players.js", async (orig) => {
      const real = await orig<typeof import("../src/data/players.js")>();
      return {
        ...real,
        loadPlayerPool: (...a: Parameters<typeof real.loadPlayerPool>) => (onRead("loadPlayerPool"), real.loadPlayerPool(...a)),
        resolveDefaultPoolPath: () => (onRead("resolveDefaultPoolPath"), real.resolveDefaultPoolPath()),
      };
    });
  } else {
    vi.doUnmock("../src/data/players.js");
  }
  const roster = await import("../src/engine/roster.js");
  const sim = await import("../src/engine/sim.js");
  const ratings = await import("../src/engine/ratings.js");
  const synergy = await import("../src/engine/synergy.js");
  const staffFit = await import("../src/engine/staff-fit.js");
  const strength = await import("../src/engine/team-strength.js");
  const fingerprint = () => ({
    games: SEEDS.map((s) => JSON.stringify(sim.simulateGame(s, "KC", "BUF"))),
    offsets: JSON.stringify(ratings.offsets()),
    reference: JSON.stringify(synergy.referenceScores()),
    fit: JSON.stringify([staffFit.schemeFitBaseline(), staffFit.schemeFitSlotBaselines()]),
    strength: JSON.stringify(roster.teamList().map((t) => strength.strengthIndex(roster.roster(t)))),
  });
  return { roster, sim, ratings, synergy, fingerprint };
}

const savedEnv = process.env.NFL_POOL_PATH;
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("../src/data/players.js");
  if (savedEnv === undefined) delete process.env.NFL_POOL_PATH;
  else process.env.NFL_POOL_PATH = savedEnv;
});

describe("reference pool is an explicit, versioned input", () => {
  it("the default path is unchanged: it resolves the host's pool and reports its version", async () => {
    const e = await freshEngine(FIXTURE);
    const info = e.roster.referencePoolInfo();
    expect(info.source).toBe("default");
    expect(info.path).toBe(FIXTURE);
    expect(info.players).toBe(fixturePool.length);
    expect(info.version).toMatch(/^[0-9a-f]{64}$/);
    expect(info.version).toBe(e.roster.poolVersion(fixturePool));
  });

  it("supplying the pool the default would have loaded changes nothing", async () => {
    const dflt = await freshEngine(FIXTURE);
    const a = dflt.fingerprint();
    const expl = await freshEngine(FIXTURE);
    expl.roster.setReferencePool(fixturePool);
    expect(expl.roster.referencePoolInfo().source).toBe("explicit");
    expect(expl.fingerprint()).toEqual(a);
  });

  it("with a supplied pool, the host's files do not matter", async () => {
    const reference = (await freshEngine(FIXTURE)).fingerprint();
    // host A: no override at all (local pool if the machine has one, else the 8-player sample);
    // host B: an override naming the 8-player sample; host C: an override naming a file that is not there
    for (const env of [undefined, SAMPLE, "/nonexistent/players.json"]) {
      const e = await freshEngine(env);
      e.roster.setReferencePool(fixturePool);
      expect(e.fingerprint(), `NFL_POOL_PATH=${env}`).toEqual(reference);
    }
  });

  it("fails if the engine run path reads the pool implicitly once one is supplied", async () => {
    const reads: string[] = [];
    const e = await freshEngine(FIXTURE, { onRead: (w) => reads.push(w) });
    e.roster.setReferencePool(fixturePool);
    e.fingerprint();
    e.sim.simulateGame(9, "SF", "DAL");
    expect(reads).toEqual([]);

    // control: the detector does see the default path, so an empty list means something
    const c = await freshEngine(FIXTURE, { onRead: (w) => reads.push(w) });
    c.fingerprint();
    expect(reads).toContain("loadPlayerPool");
  });

  it("derived values follow the supplied pool, in both directions", async () => {
    const e = await freshEngine(FIXTURE);
    const original = e.fingerprint();
    const v0 = e.roster.referencePoolInfo().version;

    // a league where every quarterback has been replaced by a much worse one
    const worse: Player[] = fixturePool.map((p) =>
      p.position === "QB" ? { ...p, overall: Math.max(1, (p.overall ?? 60) - 25), attributes: Object.fromEntries(Object.entries(p.attributes ?? {}).map(([k, v]) => [k, typeof v === "number" ? Math.max(1, v - 25) : v])) } as Player : p,
    );
    const info = e.roster.setReferencePool(worse);
    expect(info.version).not.toBe(v0);
    const moved = e.fingerprint();
    expect(moved.offsets).not.toBe(original.offsets);
    expect(moved.reference).not.toBe(original.reference);
    expect(moved.strength).not.toBe(original.strength);

    // and back: nothing computed on the other pool survives
    e.roster.setReferencePool(fixturePool);
    expect(e.fingerprint()).toEqual(original);
    e.roster.setReferencePool(null);
    expect(e.roster.referencePoolInfo().version).toBe(v0);
    expect(e.fingerprint()).toEqual(original);
  });

  it("setReferencePool is process-wide and restorable: a pool can be replaced, nested and put back", async () => {
    const e = await freshEngine(FIXTURE);
    const v0 = e.roster.referencePoolInfo().version;
    const a = fixturePool.slice(0, 200);
    const b = fixturePool.slice(0, 300);
    e.roster.setReferencePool(a);
    e.roster.setReferencePool(b); // replaces, does not stack
    expect(e.roster.referencePoolInfo()).toMatchObject({ source: "explicit", players: 300 });
    // a caller that restores in finally gets the previous pool back even if its work throws
    const prev = e.roster.referencePoolInfo().version;
    expect(() => {
      e.roster.setReferencePool(a);
      try {
        throw new Error("boom");
      } finally {
        e.roster.setReferencePool(b);
      }
    }).toThrow("boom");
    expect(e.roster.referencePoolInfo().version).toBe(prev);
    e.roster.setReferencePool(null);
    expect(e.roster.referencePoolInfo()).toMatchObject({ source: "default", version: v0 });
  });

  it("the version is a content hash that is sensitive to content and order", async () => {
    const { roster } = await freshEngine(FIXTURE);
    const v = roster.poolVersion(fixturePool);
    expect(roster.poolVersion([...fixturePool])).toBe(v);
    expect(roster.poolVersion([...fixturePool].reverse())).not.toBe(v);
    expect(roster.poolVersion(fixturePool.slice(1))).not.toBe(v);
  });
});
