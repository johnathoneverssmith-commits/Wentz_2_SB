/**
 * What the local league server launcher is allowed to do, decided before any server or database module
 * exists in the process. Nothing here connects to anything or imports the server.
 *
 * The launcher used to be `process.env.DATABASE_URL ??= <local database>` followed by an in-process import of
 * the real server. A shell that already had a production URL exported therefore ran the real server against
 * it, and the server applies the schema on start-up. The rules now:
 *
 *   - the database is chosen explicitly (`--test-database`, `LOCAL_SERVER_TEST_DATABASE`, or the documented
 *     default `local-pglite`) and must pass the same test-database rules as the verification tools: this
 *     machine only, port 5433 or a name containing "test", no query string, never prod/production/live;
 *   - a database setting inherited from the shell is never used. One that differs from the choice is an
 *     unauthorized override and the launch is refused, naming the variable and never its value;
 *   - the server runs in a child process whose environment is built from a short allowlist plus the validated
 *     settings, never from the launcher's own environment;
 *   - it listens on the loopback interface only, on a port nobody else is using;
 *   - the address the test harness sends requests to (LEAGUE_API) is loopback too.
 */
import {
  baseEnvironment,
  resolveTestDatabase,
} from "../../.claude/skills/wentz-verify/db-safety.mjs";

export const LOOPBACK_ADDRESS = "127.0.0.1";
export const DEFAULT_PORT = 8788;
export const DEFAULT_CLIENT_ORIGIN = "http://localhost:5173";
/** The one variable that may carry the database choice into the launcher, besides the command line. */
export const SELECTION_VARIABLE = "LOCAL_SERVER_TEST_DATABASE";

/** Database variables the launcher itself may see without it being an override (it sets the first itself). */
const EXEMPT = new Set(["DB_POOL_MAX", SELECTION_VARIABLE, "LOCAL_DB_PORT", "LOCAL_DB_DIR"]);

/**
 * Variables that can steer which database a Node `pg` client connects to: the URLs, libpq's own `PG*`
 * variables, and the usual aliases. Other database-flavoured variables (an API key for a hosted service)
 * cannot, so they are dropped from the child's environment without stopping the launch.
 */
export function isConnectionVariable(name: string): boolean {
  if (EXEMPT.has(name.toUpperCase())) return false;
  return (
    /^(TEST_)?DATABASE/i.test(name) ||
    /DATABASE_URL/i.test(name) ||
    /^PG/i.test(name) ||
    /^POSTGRES/i.test(name) ||
    /DIRECT_URL/i.test(name) ||
    /(^|_)(DSN|DB_URL)$/i.test(name)
  );
}

export interface LauncherConfig {
  databaseUrl: string;
  /** A description with no credentials, safe to print. */
  databaseDescription: string;
  port: number;
  clientOrigin: string;
  /** The complete environment of the server process. */
  env: Record<string, string>;
}

export type Resolved = { ok: true; config: LauncherConfig } | { ok: false; problems: string[] };

const argValue = (argv: string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const LOOPBACK_NAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** A loopback http(s) origin with an explicit port, nothing else in it. Returns the origin or a reason. */
export function checkLoopbackOrigin(raw: string, what: string): { ok: true; origin: string; port: number } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `${what} is not a valid URL` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: `${what} must be an http(s) URL` };
  if (!LOOPBACK_NAMES.has(url.hostname.toLowerCase())) return { ok: false, reason: `${what} points at "${url.hostname}", which is not this machine (localhost, 127.0.0.1 or ::1)` };
  if (url.username || url.password) return { ok: false, reason: `${what} must not carry credentials` };
  if (url.search || url.hash) return { ok: false, reason: `${what} must not have a query string or fragment` };
  if (url.pathname !== "/" && url.pathname !== "") return { ok: false, reason: `${what} must be an origin with no path` };
  if (!url.port) return { ok: false, reason: `${what} must name its port` };
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return { ok: false, reason: `${what} has a port outside 1024-65535` };
  return { ok: true, origin: url.origin, port };
}

/**
 * The address the HTTP test harness may send requests to. Called before its first request: a LEAGUE_API that
 * names a deployed server would otherwise have the harness register accounts and play leagues there.
 */
export function validateLeagueApi(raw: string | undefined): { ok: true; api: string } | { ok: false; reason: string } {
  const value = raw ?? `http://localhost:${DEFAULT_PORT}`;
  const r = checkLoopbackOrigin(value, "LEAGUE_API");
  return r.ok ? { ok: true, api: r.origin } : { ok: false, reason: r.reason };
}

/**
 * Decides, from the command line and the environment, whether the server may be launched and how.
 * Pure: reads nothing but its arguments.
 */
export function resolveLauncherConfig(argv: string[], parentEnv: NodeJS.ProcessEnv): Resolved {
  const problems: string[] = [];

  const selection = argValue(argv, "--test-database") ?? parentEnv[SELECTION_VARIABLE] ?? "local-pglite";
  const chosen = resolveTestDatabase(selection);
  if (!chosen.ok) problems.push(`database: ${chosen.reason}`);

  // a database setting from the shell is never used; one that disagrees with the choice is refused outright
  const overrides = Object.entries(parentEnv)
    .filter(([name, value]) => value !== undefined && value !== "" && isConnectionVariable(name))
    .filter(([, value]) => !chosen.ok || value !== chosen.url)
    .map(([name]) => name)
    .sort();
  if (overrides.length > 0) {
    problems.push(
      `the environment sets ${overrides.join(", ")}: a database setting inherited from the shell is not used and is refused (unset it; the database is chosen with --test-database or ${SELECTION_VARIABLE}, default local-pglite)`,
    );
  }

  const portText = argValue(argv, "--port") ?? parentEnv.PORT ?? String(DEFAULT_PORT);
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1024 || port > 65535) problems.push("port: PORT must be a whole number from 1024 to 65535");

  const clientText = argValue(argv, "--client-origin") ?? parentEnv.CLIENT_ORIGIN ?? DEFAULT_CLIENT_ORIGIN;
  const client = checkLoopbackOrigin(clientText, "CLIENT_ORIGIN");
  if (!client.ok) problems.push(client.reason);

  if (problems.length > 0 || !chosen.ok || !client.ok) return { ok: false, problems };

  // the server's whole environment: an allowlist plus the validated settings, nothing else from this shell
  const env: Record<string, string> = {
    ...baseEnvironment(parentEnv),
    DATABASE_URL: chosen.url,
    DB_POOL_MAX: "1",
    PORT: String(port),
    CLIENT_ORIGIN: client.origin,
    WENTZ_LOOPBACK_ONLY: "1",
  };
  return { ok: true, config: { databaseUrl: chosen.url, databaseDescription: chosen.description, port, clientOrigin: client.origin, env } };
}

/** Replaces the database URL, and the password in it, in a line of output before it is shown. */
export function redact(line: string, databaseUrl: string): string {
  let out = line.split(databaseUrl).join("<test database>");
  try {
    const password = new URL(databaseUrl).password;
    if (password) out = out.split(password).join("<password>");
  } catch {
    // not a URL: nothing more to hide
  }
  return out;
}
