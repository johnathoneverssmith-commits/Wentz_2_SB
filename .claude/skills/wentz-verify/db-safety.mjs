/**
 * Keeps a verification run away from any database it was not pointed at on purpose.
 *
 * The online tests connect to whatever DATABASE_URL (or TEST_DATABASE_URL) holds,
 * and the one-time global setup then APPLIES THE SCHEMA to it. A shell that
 * already has a production URL exported, a `.env` loaded, or a Neon variable set
 * would otherwise hand it to every test process the runner starts. So:
 *
 *   1. A check never inherits the parent's environment. Its environment is built
 *      from a short allowlist (PATH, temp and home directories, the Windows
 *      system variables npm needs) and any variable that looks like database
 *      configuration is dropped even if it were on that list.
 *   2. A check that needs a database gets one only from an explicit choice,
 *      `--test-database local-pglite` or a URL, and the URL must be on this
 *      machine (localhost, 127.0.0.1 or ::1), have no query string (which could
 *      redirect it with `?host=`), and be clearly a test database: the PGlite
 *      port 5433, or a name containing "test". A name that says production, live
 *      or prod is refused either way.
 *   3. Anything else fails closed: the check is not run.
 *
 * Nothing here connects to a database.
 */

/** Variables a check may inherit. Everything not listed here is not passed on. */
const INHERITED = [
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "USERNAME", "USER", "LOGNAME",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS", "LANG", "LC_ALL", "TERM", "TZ", "SHELL", "NO_COLOR", "FORCE_COLOR",
];

/** Names that are database configuration, however they are spelt. */
export function isDatabaseVariable(name) {
  return (
    /(^|_)(DATABASE|DB|DSN|PG\w*|POSTGRES\w*|PSQL\w*|NEON\w*|SUPABASE\w*|PRISMA\w*|COCKROACH\w*|MYSQL\w*|MONGO\w*|REDIS\w*)(_|$)/i.test(name) ||
    /^PG/i.test(name) ||
    /DIRECT_URL|DATABASE_URL|REQUIRE_DATABASE/i.test(name)
  );
}

/** The environment a check starts with before anything it declares itself: allowlisted, no database settings. */
export function baseEnvironment(parent = process.env) {
  const keep = new Set(INHERITED);
  const out = {};
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined) continue;
    if (!keep.has(name.toUpperCase())) continue;
    if (isDatabaseVariable(name)) continue;
    out[name] = value;
  }
  return out;
}

export const LOCAL_PGLITE_URL = "postgres://postgres@localhost:5433/postgres";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Whether `selection` is a database a verification run may use.
 * @param {string | undefined} selection  "local-pglite" or a postgres URL
 */
export function resolveTestDatabase(selection) {
  if (selection === undefined || selection === null || selection === "") {
    return { ok: false, reason: "no test database was chosen: pass --test-database local-pglite (after `npm run online:db`) or a local test database URL" };
  }
  if (selection === "local-pglite") return { ok: true, url: LOCAL_PGLITE_URL, description: "local PGlite on localhost:5433" };
  let url;
  try {
    url = new URL(selection);
  } catch {
    return { ok: false, reason: "the test database is not a valid URL" };
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return { ok: false, reason: "the test database must be a postgres:// URL" };
  if (!LOOPBACK.has(url.hostname.toLowerCase())) return { ok: false, reason: `the test database host "${url.hostname}" is not this machine (localhost, 127.0.0.1 or ::1)` };
  if (url.search !== "" || url.hash !== "") return { ok: false, reason: "the test database URL must not have a query string or fragment (`?host=` could point it elsewhere)" };
  const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!name) return { ok: false, reason: "the test database URL names no database" };
  if (/prod|production|live/i.test(name)) return { ok: false, reason: `the database name "${name}" says production` };
  if (url.port !== "5433" && !/test/i.test(name)) {
    return { ok: false, reason: `"${name}" on port ${url.port || "(default)"} is not clearly a test database: use port 5433 (PGlite) or a name containing "test"` };
  }
  const where = `${url.hostname}:${url.port || "5432"}/${name}`;
  return { ok: true, url: url.toString(), description: where };
}

/**
 * The environment for one check.
 * @param {object} check          { needsDatabase }
 * @param {object} declared       the check's validated environment (DB_POOL_MAX, CI, STATS_SEEDS)
 * @param {object} options        { parentEnv, testDatabase: string|undefined }
 */
export function environmentFor(check, declared, { parentEnv = process.env, testDatabase } = {}) {
  const env = { ...baseEnvironment(parentEnv), ...declared };
  if (!check.needsDatabase) return { ok: true, env, database: null };
  const chosen = resolveTestDatabase(testDatabase);
  if (!chosen.ok) return { ok: false, reason: `${chosen.reason} (this check needs a database)` };
  env.DATABASE_URL = chosen.url;
  env.DB_POOL_MAX = declared.DB_POOL_MAX ?? "1";
  env.CI = declared.CI ?? "true";
  return { ok: true, env, database: chosen.description };
}
