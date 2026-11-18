import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../src/engine/sha256.js";
import { loadPool, poolVersion } from "../src/engine/roster.js";

/** The pure hash replaced `node:crypto` in `roster.ts` (browser worker, issue #74 Phase 4); recorded pool versions must not change. */
const node = (s: string) => createHash("sha256").update(s).digest("hex");

describe("sha256Hex", () => {
  it("matches node:crypto on the padding boundaries and on non-ASCII text", () => {
    const cases = ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(119), "a".repeat(120), "é🏈漢字", "x".repeat(10_000)];
    for (const c of cases) expect(sha256Hex(c), `len ${c.length}`).toBe(node(c));
  });

  it("gives the same pool version as node:crypto did, on the real pool", () => {
    const pool = JSON.parse(readFileSync("test/fixtures/pool.json", "utf8"));
    expect(poolVersion(pool)).toBe(node(JSON.stringify(pool)));
    expect(loadPool().size).toBeGreaterThan(0);
  });
});
