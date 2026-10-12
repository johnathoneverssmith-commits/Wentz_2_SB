import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The schema is applied once, by test/globalSetup.ts, before the workers
 * start. A test file that applied it too would put schema DDL back next to
 * other files' open transactions, which deadlocked in CI (`40P01`: schema.sql's
 * SHARE locks and ACCESS EXCLUSIVE lock on `leagues` against a league
 * update). This keeps it from creeping back in; the cost is reading a few dozen
 * small files.
 */
const dir = new URL("./", import.meta.url);
const OWNERS = new Set([
  "globalSetup.ts", // applies it, once
  "schemaSetup.ts", // the logic of applying it
  "requireDatabase.ts", // the check that it is there
  "require-database.test.ts", // tests of the above, which name the words on purpose
  "schema-setup.test.ts",
  "no-schema-in-suites.test.ts",
]);
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !OWNERS.has(f));

describe("test files leave the schema to the global setup", () => {
  it("found the suites to check", () => {
    expect(files.length).toBeGreaterThan(40);
    expect(files).toContain("lobby.test.ts");
  });

  it.each(files)("%s does not apply the schema or run DDL", (file) => {
    const text = readFileSync(new URL(file, dir), "utf8");
    expect(text).not.toMatch(/\bmigrate\s*\(/);
    expect(text).not.toMatch(/\bschema\.sql\b/);
    expect(text).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|SCHEMA|EXTENSION)\b/i);
  });
});
