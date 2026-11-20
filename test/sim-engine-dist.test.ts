import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Issue #74 Phase 4b: the production UI build carries the browser simulation engine beside `index.html`
 * (`ui-source` build -> scripts/prepare-sim-engine.mjs -> public/sim-engine -> dist/sim-engine). CI builds the UI
 * (`npm --prefix ui-source run build`) before the tests, so this runs there; on a machine that has not built the UI
 * it is skipped, and says so.
 */
const DIST = join("ui-source", "dist");
const ENGINE = join(DIST, "sim-engine");
const built = existsSync(join(ENGINE, "manifest.json"));
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

describe.skipIf(!built)(`the built UI carries the simulation engine ${built ? "" : "(SKIPPED: ui-source/dist is not built here)"}`, () => {
  const manifest = built ? JSON.parse(readFileSync(join(ENGINE, "manifest.json"), "utf8")) : null;

  it("has the page and a manifest naming exactly the files beside it", () => {
    expect(existsSync(join(DIST, "index.html"))).toBe(true);
    expect(manifest.format).toBe(1);
    const named = [manifest.worker.url, manifest.artifacts.url, manifest.pool.url, "manifest.json"].sort();
    expect(readdirSync(ENGINE).sort()).toEqual(named);
  });

  it("every file is the size and hash the manifest promises, and its name is its hash", () => {
    for (const key of ["worker", "artifacts", "pool"] as const) {
      const e = manifest[key] as { url: string; bytes: number; sha256: string };
      const bytes = readFileSync(join(ENGINE, e.url));
      expect(bytes.length, key).toBe(e.bytes);
      expect(sha(bytes), key).toBe(e.sha256);
      expect(e.url, key).toContain(`.${e.sha256.slice(0, 12)}.`);
    }
  });

  it("the worker script needs nothing from Node, and the pool is the shipped one", () => {
    const js = readFileSync(join(ENGINE, manifest.worker.url), "utf8");
    expect(js).not.toMatch(/node:(fs|path|url|crypto|module)/);
    const pool = JSON.parse(readFileSync(join(ENGINE, manifest.pool.url), "utf8"));
    const shipped = JSON.parse(readFileSync(join("ui-source", "src", "data", "pool-2026.json"), "utf8"));
    expect(pool).toEqual(shipped);
    expect(manifest.pool.players).toBe(shipped.length);
  });
});
