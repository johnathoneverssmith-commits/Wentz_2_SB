import { inject } from "vitest";

import type { SchemaState } from "./schemaSetup.js";

/**
 * Whether a test run is one that must have a database.
 *
 * Several suites here exercise real Postgres (locks, the lobby, seats, the
 * inbox). On a laptop without one they skip — the test name says so — and that
 * is fine. But a skip is reported as a *pass*, so in CI it hides exactly the
 * failure that matters: a service that did not start, a wrong URL, a migration
 * that broke. `CI` is set by GitHub Actions; `REQUIRE_DATABASE=1` asks for the
 * same strictness anywhere else.
 */
export function databaseRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const on = (v: string | undefined) => v != null && v !== "" && v !== "0" && v.toLowerCase() !== "false";
  return on(env.CI) || on(env.REQUIRE_DATABASE);
}

/**
 * Call where a database suite would otherwise quietly return. Throws (so the
 * suite fails, loudly) when a database is required; does nothing otherwise.
 */
export function requireDatabaseInCi(why: string, env: NodeJS.ProcessEnv = process.env): void {
  if (databaseRequired(env)) {
    throw new Error(
      `${why}. This run requires a database (CI or REQUIRE_DATABASE is set), so the suite fails instead of skipping.`,
    );
  }
}

/**
 * Secrets this run was given, to be removed wherever they turn up.
 *
 * Pattern-matching can only recognise a credential by the words around it. A
 * password that an error message repeats on its own ("invalid value hunter2")
 * has no such words, but the run knows what it is: it came from DATABASE_URL.
 * Short values are left alone, and so are ones that are also the user or
 * database name (CI's `postgres:postgres@.../postgres`): removing "postgres"
 * from every message would hide the very words that make one readable, and a
 * credential that public protects nothing.
 */
function configuredSecrets(env: NodeJS.ProcessEnv): string[] {
  const found = new Set<string>();
  const add = (v: string | undefined, plain: ReadonlySet<string>) => {
    if (!v || v.length < 6 || plain.has(v)) return;
    found.add(v);
  };
  for (const key of ["DATABASE_URL", "TEST_DATABASE_URL"]) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const u = new URL(raw);
      const plain = new Set([decodeURIComponent(u.username), u.hostname, u.pathname.replace(/^\//, "")]);
      add(u.password, plain);
      add(decodeURIComponent(u.password), plain);
    } catch {
      // not a URL: nothing to take apart, and the patterns below still apply
    }
  }
  add(env.PGPASSWORD, new Set());
  return [...found];
}

/** The words that name a secret: password, passwd, pwd, secret, token, api key... in any setting name. */
const SECRET_KEY = String.raw`[\w.\-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|private[_-]?key)[\w.\-]*`;
/** A quote mark, possibly backslash-escaped because the text sits inside a JSON string. */
const QUOTE = String.raw`(?:\\*["'])?`;
/** A value, whatever it is wrapped in: escaped-quoted, "double", 'single' (with doubled or escaped quotes inside), or bare. */
const SECRET_VALUE = String.raw`\\+["'].*?\\+["']|"(?:[^"\\]|\\.|"")*"|'(?:[^'\\]|\\.|'')*'|[^\s,;&)}\]"']+`;
const SECRET_SETTING = new RegExp(String.raw`${QUOTE}(${SECRET_KEY})${QUOTE}(\s*[=:]\s*)(?:${SECRET_VALUE})`, "gi");
const AUTH_HEADER = /\b(authorization)\s*[=:]\s*(?:bearer|basic)?\s*[^\s,;"']+/gi;

/**
 * Text bound for a log or a failure message, with credentials and database
 * URLs removed. In order:
 *
 *  1. the secrets this run was configured with, wherever they appear;
 *  2. any postgres:// URL, whole (its host and database name are not needed
 *     here, and a password may sit in the userinfo, the query string, or both);
 *  3. other URLs' user:password@ part;
 *  4. any setting whose name says it is secret, in `key=value`, `key: value`,
 *     quoted or unquoted, JSON (`"password": "two words"`), escaped JSON inside
 *     a string, and libpq's `password='it''s secret'` form;
 *  5. an Authorization header's credential.
 *
 * A server's own messages name the user and never the password; this is the
 * belt to that pair of braces, so it prefers removing too much to too little.
 */
export function scrub(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const secret of configuredSecrets(env)) out = out.split(secret).join("***");
  return out
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]*/gi, "postgres://[redacted]")
    .replace(/\b([a-z][a-z0-9+.\-]*:\/\/)[^\s/?#"']*@/gi, "$1***@")
    .replace(SECRET_SETTING, (_all, key: string) => `${key}=***`)
    .replace(AUTH_HEADER, "$1=***");
}

/** The most one reported field may print; long enough for a PostgreSQL detail line, short enough to bound a log. */
const MAX_FIELD = 400;
/** Fields of a PostgreSQL or Node network error that say what happened and where, never what was sent. */
const SAFE_FIELDS = ["severity", "detail", "hint", "constraint", "schema", "table", "routine", "syscall", "address", "port"];

/**
 * What went wrong, in one line, with the facts that tell one cause from another.
 *
 * "The database could not be reached" fits a refused connection, a full
 * server, a dropped socket, a failed migration and a login error alike, and
 * the first thing anybody needs is which. The code is a SQLSTATE for an error
 * the server reported (23505 unique violation, 40P01 deadlock, 53300 too many
 * connections, 28P01 bad password...) or a Node code for one it never answered
 * (ECONNREFUSED, ECONNRESET, ETIMEDOUT).
 *
 * It reads a fixed list of fields rather than printing the error: no stack,
 * no query text or parameters (`where`, `query`), no config or connection
 * object, nothing it was not asked to look at. Each field is shortened and
 * scrubbed, and the cause chain and an AggregateError's members are read the
 * same way.
 */
export function describeDbError(err: unknown, depth = 0, env: NodeJS.ProcessEnv = process.env): string {
  const clean = (v: string) => {
    const s = scrub(v, env);
    return s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}...` : s;
  };
  if (err == null) return "no error was given";
  if (typeof err !== "object") return clean(String(err));
  const e = err as Record<string, unknown> & { errors?: unknown[]; cause?: unknown };
  const field = (v: unknown) => (typeof v === "string" || typeof v === "number" ? clean(String(v)) : null);
  // a name and a code are short identifiers; anything else in those slots is not one
  const ident = (v: unknown, max: number) => {
    const t = typeof v === "string" || typeof v === "number" ? String(v) : "";
    return t.length > 0 && t.length <= max && /^[\w.$\-]+$/.test(t) ? t : null;
  };
  const name = ident(e.name, 60) ?? "Error";
  const code = ident(e.code, 24);
  const message = field(e.message) || "(no message)";
  const extras = SAFE_FIELDS.map((k) => [k, field(e[k])] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  let line = `${name}${code ? `[${code}]` : ""}: ${message}${extras.length ? ` (${extras.join("; ")})` : ""}`;
  // "localhost" resolving to several addresses throws one error holding them all
  if (Array.isArray(e.errors) && e.errors.length > 0 && depth < 2) {
    const inner = e.errors.slice(0, 4).map((x) => describeDbError(x, depth + 1, env));
    line += ` - ${e.errors.length} attempts: ${inner.join(" | ")}`;
  }
  if (e.cause != null && depth < 3) line += ` - caused by: ${describeDbError(e.cause, depth + 1, env)}`;
  return line;
}

/** The little of a `pg` Pool that preparing a database needs. */
interface Queryable {
  query(sql: string): Promise<unknown>;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
}

export type DatabaseAttempt = { reachable: true } | { reachable: false; failure: string };

/** What the one-time setup recorded for this run, if it ran (see `globalSetup.ts`). */
function recordedSchemaState(): SchemaState | undefined {
  try {
    return inject("databaseSchema");
  } catch {
    return undefined; // not inside a Vitest run with the setup configured
  }
}

/**
 * Connects, and checks that the schema is there. Never applies it.
 *
 * The schema is applied once, before any test file starts (`globalSetup.ts`).
 * A suite applying it again in its own `beforeAll` is what deadlocked in CI:
 * `schema.sql` is one transaction that takes SHARE locks and then an ACCESS
 * EXCLUSIVE lock on `leagues`, and it collided with another file's open league
 * transaction. So here a worker reads one catalog entry and nothing more.
 *
 * Says exactly what failed if anything did: whether the one-time setup failed
 * before any test ran, the connection failed, or the schema is missing, with the
 * error's code, how long it took, which test worker this was, and how many
 * connections its pool held. It does not retry or work around anything.
 */
export async function prepareDatabase(
  pool: Queryable,
  schema: SchemaState | undefined = recordedSchemaState(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<DatabaseAttempt> {
  if (schema?.state === "failed") {
    return {
      reachable: false,
      failure: scrub(`the one-time schema setup failed before any test file started: ${schema.failure}`, env).slice(0, 2000),
    };
  }
  let step = "connecting";
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    step = "checking the schema";
    const found = (await pool.query("SELECT to_regclass('public.league_state') AS t")) as
      | { rows?: { t: string | null }[] }
      | undefined;
    const row = found?.rows?.[0];
    // A catalog query always returns its one row. Not getting one means the
    // check cannot be confirmed, which must not count as confirmed.
    if (!row) throw new Error("the schema check returned no row, so the schema cannot be confirmed");
    if (row.t == null) {
      throw new Error(
        "the schema is not there (no league_state table): online/vitest.config.ts applies it once through test/globalSetup.ts before the workers start",
      );
    }
    return { reachable: true };
  } catch (err) {
    const where = `worker ${env.VITEST_POOL_ID ?? "?"}/${env.VITEST_WORKER_ID ?? "?"}`;
    const conns = `${pool.totalCount ?? "?"} open, ${pool.idleCount ?? "?"} idle, ${pool.waitingCount ?? "?"} waiting`;
    const failure = `${step} failed after ${Date.now() - started} ms: ${describeDbError(err, 0, env)} [${where}; pool ${conns}]`;
    return { reachable: false, failure: scrub(failure, env).slice(0, 2000) };
  }
}
