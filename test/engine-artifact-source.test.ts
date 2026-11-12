import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #74 Phase 2: the engine reads its committed artifacts through one
 * injectable, synchronous source (`artifact-source.ts`). The default is the
 * same `fs` read as before; a supplied source must give the same football, and
 * switching sources must never serve values derived from the other one.
 * Fresh engine per case (`vi.resetModules`): the source and its derived caches
 * are module state.
 */
const FIXTURE = resolve("test/fixtures/pool.json");
const ARTIFACTS = resolve("artifacts");
const SEEDS = [1, 7, 42];

/** Every artifact file the engine can load, keyed by its path under artifacts/. */
function allArtifacts(): Record<string, unknown> {
  const files: Record<string, unknown> = {};
  const add = (dir: string) => {
    for (const f of readdirSync(join(ARTIFACTS, dir))) {
      if (f.endsWith(".json")) files[`${dir}/${f}`] = JSON.parse(readFileSync(join(ARTIFACTS, dir, f), "utf8"));
    }
  };
  add("models/portable");
  add("distributions/portable");
  add("ratings");
  files["models/derived_fit_baseline.json"] = JSON.parse(readFileSync(join(ARTIFACTS, "models/derived_fit_baseline.json"), "utf8"));
  return files;
}

async function freshEngine(onFsRead?: (path: string) => void) {
  vi.resetModules();
  process.env.NFL_POOL_PATH = FIXTURE;
  if (onFsRead) {
    vi.doMock("node:fs", async (orig) => {
      const real = await orig<typeof import("node:fs")>();
      return { ...real, readFileSync: ((p: unknown, ...a: unknown[]) => (onFsRead(String(p)), (real.readFileSync as (...x: unknown[]) => unknown)(p, ...a))) as typeof real.readFileSync };
    });
  } else {
    vi.doUnmock("node:fs");
  }
  const src = await import("../src/engine/artifact-source.js");
  const roster = await import("../src/engine/roster.js");
  const sim = await import("../src/engine/sim.js");
  const ratings = await import("../src/engine/ratings.js");
  const synergy = await import("../src/engine/synergy.js");
  const staffFit = await import("../src/engine/staff-fit.js");
  const fingerprint = () => ({
    games: SEEDS.map((s) => JSON.stringify(sim.simulateGame(s, "KC", "BUF"))),
    offsets: JSON.stringify(ratings.offsets()),
    reference: JSON.stringify(synergy.referenceScores()),
    fit: JSON.stringify(staffFit.schemeFitBaseline()),
  });
  return { src, roster, fingerprint };
}

const savedEnv = process.env.NFL_POOL_PATH;
beforeEach(() => vi.resetModules());
afterEach(() => {
  vi.doUnmock("node:fs");
  if (savedEnv === undefined) delete process.env.NFL_POOL_PATH;
  else process.env.NFL_POOL_PATH = savedEnv;
});

describe("artifact source is an explicit, injectable engine input", () => {
  it("the default source is the repository's artifacts/ read with fs", async () => {
    const { src } = await freshEngine();
    expect(src.artifactSource().id).toBe("node-fs");
    const path = "ratings/attribute_reference_stats.json";
    expect(src.readArtifactJson(path)).toEqual(JSON.parse(readFileSync(join(ARTIFACTS, path), "utf8")));
    expect(() => src.readArtifactJson("models/portable/nope.json")).toThrow();
  });

  it("a memory source holding the same artifacts plays identical football", async () => {
    const base = await freshEngine();
    const expected = base.fingerprint();
    const e = await freshEngine();
    e.src.setArtifactSource(e.src.createMemoryArtifactSource(allArtifacts()));
    expect(e.src.artifactSource().id).toBe("memory");
    expect(e.fingerprint()).toEqual(expected);
  });

  it("fails if the engine reads an artifact from disk once a source is supplied", async () => {
    const reads: string[] = [];
    const e = await freshEngine((p) => reads.push(p));
    e.src.setArtifactSource(e.src.createMemoryArtifactSource(allArtifacts()));
    reads.length = 0; // the test's own reads, and the pool, are not the engine's artifact reads
    e.fingerprint();
    expect(reads.filter((p) => p.includes("/artifacts/"))).toEqual([]);

    // control: the detector does see the default path
    const c = await freshEngine((p) => reads.push(p));
    reads.length = 0;
    c.fingerprint();
    expect(reads.some((p) => p.includes("/artifacts/"))).toBe(true);
  });

  it("derived values follow the source in both directions", async () => {
    const e = await freshEngine();
    const original = e.fingerprint();

    const files = allArtifacts();
    const stats = structuredClone(files["ratings/attribute_reference_stats.json"]) as { attribute_reference_stats: Record<string, { mean: number; sd: number }> };
    for (const r of Object.values(stats.attribute_reference_stats)) r.mean += 5;
    e.src.setArtifactSource(e.src.createMemoryArtifactSource({ ...files, "ratings/attribute_reference_stats.json": stats }));
    const moved = e.fingerprint();
    expect(moved.offsets).not.toBe(original.offsets);
    expect(moved.reference).not.toBe(original.reference);

    e.src.setArtifactSource(null);
    expect(e.src.artifactSource().id).toBe("node-fs");
    expect(e.fingerprint()).toEqual(original);
  });

  it("REQUIRED_ARTIFACTS lists exactly the artifact files on disk", async () => {
    const { src } = await freshEngine();
    expect([...src.REQUIRED_ARTIFACTS].sort()).toEqual(Object.keys(allArtifacts()).sort());
  });

  it("a failed install preserves the active source and the engine's results", async () => {
    const e = await freshEngine();
    const files = allArtifacts();
    const { ["models/portable/M04.json"]: _gone, ...missingOne } = files;
    const throwing = { id: "throws", readJson: () => { throw new Error("disk on fire"); } };

    // from the default
    const base = e.fingerprint();
    expect(() => e.src.setArtifactSource(e.src.createMemoryArtifactSource({}))).toThrow(/rejected: .*artifact not found/);
    expect(() => e.src.setArtifactSource(e.src.createMemoryArtifactSource(missingOne, "partial"))).toThrow(/"partial" rejected: models\/portable\/M04\.json/);
    expect(() => e.src.setArtifactSource(throwing)).toThrow(/"throws" rejected: .*disk on fire/);
    expect(e.src.artifactSource().id).toBe("node-fs");
    expect(e.fingerprint()).toEqual(base);

    // from a supplied one: it stays installed and its results are untouched
    const shifted = structuredClone(files["ratings/attribute_reference_stats.json"]) as { attribute_reference_stats: Record<string, { mean: number }> };
    for (const r of Object.values(shifted.attribute_reference_stats)) r.mean += 5;
    const good = e.src.createMemoryArtifactSource({ ...files, "ratings/attribute_reference_stats.json": shifted }, "shifted");
    e.src.setArtifactSource(good);
    const active = e.fingerprint();
    expect(active.offsets).not.toBe(base.offsets);
    expect(() => e.src.setArtifactSource(throwing)).toThrow(/rejected/);
    expect(e.src.artifactSource()).toBe(good);
    expect(e.fingerprint()).toEqual(active);
  });

  it("switching between two sources with the pool fixed refreshes artifact-dependent results", async () => {
    const files = allArtifacts();
    const withShift = (d: number) => {
      const st = structuredClone(files["ratings/attribute_reference_stats.json"]) as { attribute_reference_stats: Record<string, { mean: number }> };
      for (const r of Object.values(st.attribute_reference_stats)) r.mean += d;
      return (e: Awaited<ReturnType<typeof freshEngine>>) => e.src.createMemoryArtifactSource({ ...files, "ratings/attribute_reference_stats.json": st }, `shift${d}`);
    };
    const [A, B] = [withShift(3), withShift(-4)];

    // what each source gives on its own, in a process that never saw the other
    const aloneA = await freshEngine();
    aloneA.src.setArtifactSource(A(aloneA));
    const expectA = aloneA.fingerprint();
    const aloneB = await freshEngine();
    aloneB.src.setArtifactSource(B(aloneB));
    const expectB = aloneB.fingerprint();
    expect(expectA.offsets).not.toBe(expectB.offsets);

    // one process, the same explicit pool throughout, A -> B -> A -> default
    const e = await freshEngine();
    const base = e.fingerprint();
    const pool = JSON.parse(readFileSync(FIXTURE, "utf8"));
    e.roster.setReferencePool(pool);
    const version = e.roster.referencePoolInfo().version;
    e.src.setArtifactSource(A(e));
    expect(e.fingerprint()).toEqual(expectA);
    e.src.setArtifactSource(B(e));
    expect(e.fingerprint()).toEqual(expectB);
    e.src.setArtifactSource(A(e));
    expect(e.fingerprint()).toEqual(expectA);
    e.src.setArtifactSource(null);
    expect(e.fingerprint()).toEqual(base); // restoring the default restores the baseline output
    expect(e.roster.referencePoolInfo().version).toBe(version);
  });

  it("switching sources does not reload the pool or rebuild the rosters", async () => {
    let loads = 0;
    vi.resetModules();
    process.env.NFL_POOL_PATH = FIXTURE;
    vi.doMock("../src/data/players.js", async (orig) => {
      const real = await orig<typeof import("../src/data/players.js")>();
      return { ...real, loadPlayerPool: (...a: Parameters<typeof real.loadPlayerPool>) => (loads++, real.loadPlayerPool(...a)) };
    });
    const src = await import("../src/engine/artifact-source.js");
    const roster = await import("../src/engine/roster.js");
    const sim = await import("../src/engine/sim.js");
    const kc = roster.roster("KC");
    const pool = roster.loadPool();
    const version = roster.referencePoolInfo().version;
    expect(loads).toBe(1);

    src.setArtifactSource(src.createMemoryArtifactSource(allArtifacts()));
    sim.simulateGame(5, "KC", "BUF");
    src.setArtifactSource(null);
    sim.simulateGame(5, "KC", "BUF");

    expect(loads).toBe(1); // default pool read once, never again
    expect(roster.roster("KC")).toBe(kc);
    expect(roster.loadPool()).toBe(pool);
    expect(roster.referencePoolInfo().version).toBe(version);
    vi.doUnmock("../src/data/players.js");
  });
});
