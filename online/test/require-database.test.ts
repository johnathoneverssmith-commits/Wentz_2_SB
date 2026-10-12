import { describe, expect, it } from "vitest";

import { databaseRequired, requireDatabaseInCi } from "./requireDatabase.js";

describe("database suites in CI", () => {
  it("lets a suite skip on a machine with no database", () => {
    expect(databaseRequired({})).toBe(false);
    expect(() => requireDatabaseInCi("no database", {})).not.toThrow();
  });

  it("fails a suite instead of skipping when CI is set", () => {
    expect(databaseRequired({ CI: "true" })).toBe(true);
    expect(() => requireDatabaseInCi("DATABASE_URL is not set", { CI: "true" })).toThrow(/requires a database/);
  });

  it("can be switched on anywhere, and off again", () => {
    expect(databaseRequired({ REQUIRE_DATABASE: "1" })).toBe(true);
    expect(databaseRequired({ REQUIRE_DATABASE: "0" })).toBe(false);
    expect(databaseRequired({ CI: "false" })).toBe(false);
    expect(databaseRequired({ CI: "" })).toBe(false);
  });

  it("says why, so a failed run points at the cause", () => {
    expect(() => requireDatabaseInCi("The database could not be reached", { CI: "1" })).toThrow(
      /could not be reached/,
    );
  });
});
