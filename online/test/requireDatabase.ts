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
