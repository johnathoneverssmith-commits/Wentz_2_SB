import { describe, expect, it } from "vitest";

import { databaseRequired, describeDbError, prepareDatabase, requireDatabaseInCi, scrub } from "./requireDatabase.js";

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

/** The shapes `pg` and Node really throw, built by hand. */
const pgError = (fields: Record<string, string>, message: string) =>
  Object.assign(new Error(message), { name: "error", ...fields });
const netError = (code: string, message: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { code, ...extra });

describe("what a failed database setup reports", () => {
  it("keeps the SQLSTATE and the facts of a server error", () => {
    const text = describeDbError(
      pgError(
        { code: "23505", severity: "ERROR", detail: "Key (typname, typnamespace)=(users, 2200) already exists.", constraint: "pg_type_typname_nsp_index", routine: "_bt_check_unique" },
        'duplicate key value violates unique constraint "pg_type_typname_nsp_index"',
      ),
    );
    expect(text).toContain("[23505]");
    expect(text).toContain("duplicate key value violates unique constraint");
    expect(text).toContain("constraint: pg_type_typname_nsp_index");
    expect(text).toContain("routine: _bt_check_unique");
  });

  it("keeps where a refused connection was going, and every address it tried", () => {
    const one = netError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432", { syscall: "connect", address: "127.0.0.1", port: 5432 });
    expect(describeDbError(one)).toMatch(/\[ECONNREFUSED\].*address: 127\.0\.0\.1; port: 5432/);
    const many = Object.assign(new Error(""), { name: "AggregateError", code: "ECONNREFUSED", errors: [one, netError("ECONNREFUSED", "connect ECONNREFUSED ::1:5432")] });
    const text = describeDbError(many);
    expect(text).toContain("2 attempts");
    expect(text).toContain("::1:5432");
  });

  it("never prints a password, in a connection string or a setting", () => {
    const text = describeDbError(
      netError("ECONNRESET", "failed for postgres://ci_user:hunter2secret@db.example.com:5432/app (password=hunter2secret)"),
    );
    expect(text).not.toContain("hunter2secret");
    expect(text).toContain("postgres://***@db.example.com");
    expect(scrub("postgresql://u:p@h/db")).toBe("postgresql://***@h/db");
    expect(scrub("password: s3cret")).toBe("password=***");
  });

  it("copes with things that are not errors", () => {
    expect(describeDbError(undefined)).toMatch(/no error/);
    expect(describeDbError("plain text")).toBe("plain text");
    expect(describeDbError({})).toContain("no message");
  });
});

describe("preparing the database", () => {
  const pool = (query: (sql: string) => Promise<unknown>) => ({ query, totalCount: 2, idleCount: 1, waitingCount: 0 });

  it("is reachable once it connects and the schema applies, in that order", async () => {
    const order: string[] = [];
    const result = await prepareDatabase(
      pool(async (sql) => void order.push(sql)),
      async () => void order.push("migrate"),
    );
    expect(result).toEqual({ reachable: true });
    expect(order).toEqual(["SELECT 1", "migrate"]);
  });

  it("names the connection step when the connection fails, without running the schema", async () => {
    let migrated = false;
    const result = await prepareDatabase(
      pool(async () => {
        throw netError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432");
      }),
      async () => void (migrated = true),
      { VITEST_POOL_ID: "3", VITEST_WORKER_ID: "7" },
    );
    expect(migrated).toBe(false);
    expect(result.reachable).toBe(false);
    const failure = (result as { failure: string }).failure;
    expect(failure).toContain("connecting failed after");
    expect(failure).toContain("[ECONNREFUSED]");
    expect(failure).toContain("worker 3/7");
    expect(failure).toContain("pool 2 open, 1 idle, 0 waiting");
  });

  it("names the schema step when the migration fails, with the server's own error", async () => {
    const result = await prepareDatabase(
      pool(async () => undefined),
      async () => {
        throw pgError({ code: "XX000", severity: "ERROR" }, "tuple concurrently updated");
      },
    );
    const failure = (result as { failure: string }).failure;
    expect(failure).toContain("applying the schema failed after");
    expect(failure).toContain("[XX000]");
    expect(failure).toContain("tuple concurrently updated");
  });

  it("reaches the failing suite's message, so CI shows it", async () => {
    const attempt = await prepareDatabase(
      pool(async () => {
        throw pgError({ code: "53300" }, "sorry, too many clients already");
      }),
      async () => undefined,
    );
    expect(() =>
      requireDatabaseInCi(`The database could not be reached: ${(attempt as { failure: string }).failure}`, { CI: "true" }),
    ).toThrow(/53300.*too many clients already/);
  });
});
