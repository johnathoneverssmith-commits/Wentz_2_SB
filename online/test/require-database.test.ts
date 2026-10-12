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
    expect(text).not.toContain("db.example.com"); // a whole database URL is removed, not just its password
    expect(text).toContain("postgres://[redacted]");
    expect(scrub("postgresql://u:p@h/db")).toBe("postgres://[redacted]");
    expect(scrub("password: s3cret")).toBe("password=***");
  });

  it("copes with things that are not errors", () => {
    expect(describeDbError(undefined)).toMatch(/no error/);
    expect(describeDbError("plain text")).toBe("plain text");
    expect(describeDbError({})).toContain("no message");
  });
});

/**
 * Every shape a credential has been seen to take in an error message. Each
 * secret below is a made-up marker, so a leak is a plain substring check.
 */
describe("removing credentials from what is reported", () => {
  const SECRET = "Zq7-fake-secret";
  const none = {} as NodeJS.ProcessEnv;
  const gone = (text: string, ...also: string[]) => {
    const out = scrub(text, none);
    expect(out, text).not.toContain(SECRET);
    for (const piece of also) expect(out, text).not.toContain(piece);
    return out;
  };

  it("removes a double-quoted password, spaces included", () => {
    gone(`password="${SECRET} with spaces" host=db`, "with spaces");
    gone(`password = "${SECRET} two  words" user=u`, "two  words");
  });

  it("removes a single-quoted password, spaces and doubled or escaped quotes included", () => {
    gone(`dbname=app password='${SECRET} with spaces' user=u`, "with spaces");
    gone(`password='${SECRET} it''s here' sslmode=require`, "it''s", "here'");
    gone(`password='${SECRET} it\\'s here' sslmode=require`, "here'");
    // what follows the value is kept, so the message still reads
    expect(scrub(`password='${SECRET} x y' sslmode=require`, none)).toContain("sslmode=require");
  });

  it("removes JSON password properties, quoted keys and values with spaces", () => {
    gone(`{"user":"u","password":"${SECRET} has spaces","db":"app"}`, "has spaces");
    gone(`{'password': '${SECRET} two words'}`, "two words");
    expect(scrub(`{"user":"u","password":"${SECRET} x y","db":"app"}`, none)).toContain('"db":"app"');
  });

  it("removes a password inside JSON that is itself inside a JSON string", () => {
    const inner = JSON.stringify({ password: `${SECRET} nested value`, host: "h" });
    gone(JSON.stringify({ message: inner }), "nested value");
    gone(`\\"password\\":\\"${SECRET} escaped words\\"`, "escaped words");
  });

  it("removes URL-encoded credentials, in the userinfo and in a query string", () => {
    gone(`postgres://u:${SECRET.replace(/-/g, "%2D")}%40x%20y@db.example.com/app`, "%2D", "db.example.com");
    gone(`https://api.example.com/v1?user=u&password=${encodeURIComponent(`${SECRET} p@ss word`)}&x=1`, "p%40ss");
    gone(`postgresql://u:pa%2Fss%3Aw%40rd-${SECRET}@h:5432/db?sslmode=require`);
  });

  it("removes a password that contains an @ or a colon", () => {
    gone(`postgres://user:${SECRET}@x:y@db.example.com/app`, "db.example.com");
    gone(`postgres://user:a:b:${SECRET}@db.example.com:5432/app`);
  });

  it("removes other secret-named settings and an Authorization header", () => {
    gone(`PGPASSWORD=${SECRET} psql`);
    gone(`api_key: ${SECRET}`);
    gone(`"access_token": "${SECRET} abc"`, "abc");
    gone(`client_secret='${SECRET} def'`, "def");
    gone(`Authorization: Bearer ${SECRET}`);
  });

  it("is case-insensitive", () => {
    gone(`PASSWORD='${SECRET} UP'`, "UP'");
    gone(`Password: ${SECRET}`);
  });

  it("removes the secrets this run was configured with, even with no words around them", () => {
    const env = { DATABASE_URL: `postgres://ci_user:${SECRET}@db.example.com:5432/app` } as unknown as NodeJS.ProcessEnv;
    const out = scrub(`invalid input value ${SECRET} for column x; also ${decodeURIComponent(SECRET)}`, env);
    expect(out).not.toContain(SECRET);
    // the percent-decoded form of a password is a secret too
    const encoded = { DATABASE_URL: `postgres://u:p%40ss-${SECRET}@h/db` } as unknown as NodeJS.ProcessEnv;
    expect(scrub(`bad value p@ss-${SECRET}`, encoded)).not.toContain(SECRET);
  });

  it("leaves a public test credential alone, so messages stay readable", () => {
    const ci = { DATABASE_URL: "postgres://postgres:postgres@localhost:5432/postgres" } as unknown as NodeJS.ProcessEnv;
    expect(scrub('database "postgres" does not exist', ci)).toBe('database "postgres" does not exist');
  });

  it("does not mangle ordinary messages that only mention the word", () => {
    expect(scrub('password authentication failed for user "ci_user"', none)).toBe(
      'password authentication failed for user "ci_user"',
    );
    expect(scrub("connect ECONNREFUSED 127.0.0.1:5432", none)).toBe("connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("removes secrets from every field it reports, not just the message", () => {
    const err = Object.assign(new Error(`msg password=${SECRET}`), {
      name: "error",
      code: "28P01",
      detail: `Connection matched pg_hba.conf line 99: "host all all all password='${SECRET} a b'"`,
      hint: `try {"password":"${SECRET} c d"}`,
      address: `postgres://u:${SECRET}@h/db`,
    });
    const out = describeDbError(err, 0, none);
    expect(out).not.toContain(SECRET);
    for (const piece of ["a b", "c d"]) expect(out).not.toContain(piece);
    expect(out).toContain("[28P01]");
  });

  it("removes secrets from nested PostgreSQL error details: causes and aggregated errors", () => {
    const inner = Object.assign(new Error(`could not connect: password=${SECRET}`), { code: "ECONNREFUSED" });
    const cause = Object.assign(new Error(`wrapped postgres://u:${SECRET}@h/db`), { cause: inner });
    const pg = Object.assign(new Error("deadlock detected"), {
      name: "error",
      code: "40P01",
      detail: `Process 1 waits for ShareLock; "password":"${SECRET} z z"`,
      cause,
    });
    const aggregate = Object.assign(new Error(""), { name: "AggregateError", errors: [pg, inner] });
    const out = describeDbError(aggregate, 0, none);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain("z z");
    expect(out).toContain("[40P01]"); // still useful
    expect(out).toContain("caused by");
  });

  it("never prints a stack, a query, or fields it was not asked to read", () => {
    const err = Object.assign(new Error("boom"), {
      name: "error",
      code: "XX000",
      query: `INSERT INTO users VALUES ('${SECRET}')`,
      where: `SQL statement "ALTER ROLE x PASSWORD '${SECRET}'"`,
      parameters: [SECRET],
      config: { connectionString: `postgres://u:${SECRET}@h/db` },
      password: SECRET,
    });
    err.stack = `error: boom\n    at login (${SECRET}.js:1:1)`;
    const out = describeDbError(err, 0, none);
    expect(out).not.toContain(SECRET);
    expect(out).toBe("error[XX000]: boom");
  });

  it("accepts only an identifier as a name or a code, and bounds long fields", () => {
    const err = Object.assign(new Error("m"), { name: `has spaces ${SECRET}`, code: `password=${SECRET}`, detail: "x".repeat(5000) });
    const out = describeDbError(err, 0, none);
    expect(out).not.toContain(SECRET);
    expect(out.startsWith("Error: m")).toBe(true);
    expect(out.length).toBeLessThan(600);
  });

  it("scrubs and bounds the whole failure line a suite will print", async () => {
    const attempt = await prepareDatabase(
      { query: async () => { throw Object.assign(new Error(`password='${SECRET} q r' ${"y".repeat(5000)}`), { code: "28P01" }); } },
      { state: "applied", ms: 1 },
      none,
    );
    const failure = (attempt as { failure: string }).failure;
    expect(failure).not.toContain(SECRET);
    expect(failure).not.toContain("q r");
    expect(failure.length).toBeLessThanOrEqual(2000);
    expect(failure).toContain("[28P01]");
  });
});

describe("preparing the database", () => {
  const applied = { state: "applied", ms: 5 } as const;
  /** A pool whose catalog says the schema is there (or not), recording every statement it is sent. */
  const pool = (opts: { schemaThere?: boolean; fail?: unknown; sent?: string[] } = {}) => ({
    query: async (sql: string) => {
      opts.sent?.push(sql);
      if (opts.fail) throw opts.fail;
      return /to_regclass/.test(sql) ? { rows: [{ t: opts.schemaThere === false ? null : "league_state" }] } : { rows: [] };
    },
    totalCount: 2,
    idleCount: 1,
    waitingCount: 0,
  });

  it("is reachable when it connects and the schema is there", async () => {
    const sent: string[] = [];
    expect(await prepareDatabase(pool({ sent }), applied)).toEqual({ reachable: true });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe("SELECT 1");
  });

  it("only reads: no statement it sends changes the schema", async () => {
    const sent: string[] = [];
    await prepareDatabase(pool({ sent }), applied);
    for (const sql of sent) expect(sql, sql).toMatch(/^\s*select\b/i);
    for (const sql of sent) expect(sql, sql).not.toMatch(/\b(create|alter|drop|lock)\b/i);
  });

  it("names the connection step when the connection fails", async () => {
    const result = await prepareDatabase(
      pool({ fail: netError("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:5432") }),
      applied,
      { VITEST_POOL_ID: "3", VITEST_WORKER_ID: "7" },
    );
    expect(result.reachable).toBe(false);
    const failure = (result as { failure: string }).failure;
    expect(failure).toContain("connecting failed after");
    expect(failure).toContain("[ECONNREFUSED]");
    expect(failure).toContain("worker 3/7");
    expect(failure).toContain("pool 2 open, 1 idle, 0 waiting");
  });

  it("says so, without trying to fix it, when the schema is not there", async () => {
    const sent: string[] = [];
    const result = await prepareDatabase(pool({ schemaThere: false, sent }), applied);
    const failure = (result as { failure: string }).failure;
    expect(failure).toContain("checking the schema failed after");
    expect(failure).toContain("no league_state table");
    expect(failure).toContain("globalSetup");
    expect(sent.some((sql) => /\b(create|alter)\b/i.test(sql))).toBe(false);
  });

  it("reports the one-time setup's failure, and does not even connect", async () => {
    const sent: string[] = [];
    const result = await prepareDatabase(pool({ sent }), {
      state: "failed",
      failure: "applying the schema failed after 1021 ms: error[40P01]: deadlock detected",
    });
    const failure = (result as { failure: string }).failure;
    expect(failure).toContain("before any test file started");
    expect(failure).toContain("[40P01]");
    expect(sent).toEqual([]);
  });

  it("reaches the failing suite's message, so CI shows it", async () => {
    const attempt = await prepareDatabase(pool({ fail: pgError({ code: "53300" }, "sorry, too many clients already") }), applied);
    expect(() =>
      requireDatabaseInCi(`The database could not be reached: ${(attempt as { failure: string }).failure}`, { CI: "true" }),
    ).toThrow(/53300.*too many clients already/);
  });
});
