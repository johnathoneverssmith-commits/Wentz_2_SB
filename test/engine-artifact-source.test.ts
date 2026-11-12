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
  return { src, fingerprint };
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

  it("a source missing an artifact fails with the path, not a silent default", async () => {
    const e = await freshEngine();
    e.src.setArtifactSource(e.src.createMemoryArtifactSource({}));
    expect(() => e.fingerprint()).toThrow(/artifact not found: /);
    e.src.setArtifactSource(null);
    expect(() => e.fingerprint()).not.toThrow();
  });
});
