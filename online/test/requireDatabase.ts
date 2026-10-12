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
 * Text bound for a log or a failure message, with anything that looks like a
 * credential removed: the password in a connection string, or a `password=`
 * setting. (A server's own error messages name the user, never the password;
 * this is the belt to that pair of braces.)
 */
export function scrub(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^\s@/]*@/gi, "$1***@")
    .replace(/\b(password|passwd|pwd)\s*[=:]\s*\S+/gi, "$1=***");
}

/**
 * What went wrong, in one line, with the facts that tell one cause from another.
 *
 * "The database could not be reached" fits a refused connection, a full
 * server, a dropped socket, a failed migration and a login error alike, and
 * the first thing anybody needs is which. The code is a SQLSTATE for an error
 * the server reported (23505 unique violation, 40P01 deadlock, 53300 too many
 * connections, 28P01 bad password...) or a Node code for one it never answered
 * (ECONNREFUSED, ECONNRESET, ETIMEDOUT). Never prints a connection string.
 */
export function describeDbError(err: unknown, depth = 0): string {
  if (err == null) return "no error was given";
  if (typeof err !== "object") return scrub(String(err));
  const e = err as Record<string, unknown> & { errors?: unknown[] };
  const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? scrub(String(v)) : null);
  const name = text(e.name) ?? "Error";
  const code = text(e.code);
  const message = text(e.message) || "(no message)";
  // the places a PostgreSQL error says more, and a Node network error says where
  const extras = ["severity", "detail", "hint", "constraint", "table", "routine", "syscall", "address", "port"]
    .map((k) => [k, text(e[k])] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`);
  let line = `${name}${code ? `[${code}]` : ""}: ${message}${extras.length ? ` (${extras.join("; ")})` : ""}`;
  // "localhost" resolving to several addresses throws one error holding them all
  if (Array.isArray(e.errors) && e.errors.length > 0 && depth < 2) {
    const inner = e.errors.slice(0, 4).map((x) => describeDbError(x, depth + 1));
    line += ` — ${e.errors.length} attempts: ${inner.join(" | ")}`;
  }
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

/**
 * Connects and applies the schema, and says exactly what failed if it did not.
 *
 * Replaces a bare `catch { reachable = false }` that threw the reason away:
 * a CI run failed with "could not be reached" and nothing to say whether it
 * was the connection, the schema, or two workers migrating at once. The report
 * names the step, how long it took, the error with its code, which test worker
 * it was, and how many connections that worker's pool held. It makes no
 * attempt to retry or work around anything: the point is to find out.
 */
export async function prepareDatabase(
  pool: Queryable,
  migrate: () => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DatabaseAttempt> {
  let step = "connecting";
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    step = "applying the schema";
    await migrate();
    return { reachable: true };
  } catch (err) {
    const where = `worker ${env.VITEST_POOL_ID ?? "?"}/${env.VITEST_WORKER_ID ?? "?"}`;
    const conns = `${pool.totalCount ?? "?"} open, ${pool.idleCount ?? "?"} idle, ${pool.waitingCount ?? "?"} waiting`;
    return {
      reachable: false,
      failure: `${step} failed after ${Date.now() - started} ms: ${describeDbError(err)} [${where}; pool ${conns}]`,
    };
  }
}
