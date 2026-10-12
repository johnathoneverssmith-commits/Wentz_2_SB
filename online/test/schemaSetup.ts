import { describeDbError } from "./requireDatabase.js";

/**
 * How the one-time schema setup went, handed to every test worker.
 *
 * Before any test file starts, the schema is applied once (see
 * `globalSetup.ts`). The database suites used to apply it themselves, each in
 * its own `beforeAll`, all at the same time. `schema.sql` is a single
 * transaction that takes SHARE locks on three tables and then an ACCESS
 * EXCLUSIVE lock on `leagues`, so it deadlocked with whichever other file was
 * already mid-transaction (`40P01`, seen in CI). Applying it once, before the
 * workers exist, leaves nothing for it to deadlock with.
 */
export type SchemaState =
  | { state: "skipped" } // no database configured: the suites skip, as they always did
  | { state: "applied"; ms: number }
  | { state: "failed"; failure: string };

declare module "vitest" {
  export interface ProvidedContext {
    databaseSchema: SchemaState;
  }
}

/** What applying the schema needs; loaded only when there is a database to apply it to. */
export interface SchemaDeps {
  migrate: () => Promise<void>;
  end: () => Promise<void>;
}

/**
 * Applies the schema once, if a database is configured, and says how it went.
 *
 * Never throws: a run of tests that need no database must not be failed by
 * one that is down. The failure is handed to the database suites, which fail
 * with it where the run requires a database (CI) and skip where it does not.
 * The caller prints it as well, so it is in the log whichever suites run.
 */
export async function applySchemaOnce(
  env: NodeJS.ProcessEnv,
  load: () => Promise<SchemaDeps>,
  now: () => number = Date.now,
): Promise<SchemaState> {
  if (!(env.DATABASE_URL ?? env.TEST_DATABASE_URL)) return { state: "skipped" };
  const started = now();
  let deps: SchemaDeps | undefined;
  try {
    deps = await load();
    await deps.migrate();
    return { state: "applied", ms: now() - started };
  } catch (err) {
    return {
      state: "failed",
      failure: `applying the schema failed after ${now() - started} ms: ${describeDbError(err, 0, env)}`,
    };
  } finally {
    // the setup process holds no connection once it is done; the workers bring their own
    await deps?.end().catch(() => undefined);
  }
}
