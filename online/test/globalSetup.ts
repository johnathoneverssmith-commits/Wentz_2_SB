import type { TestProject } from "vitest/node";

import { applySchemaOnce } from "./schemaSetup.js";

/**
 * Runs once, in the main process, before any test file starts.
 *
 * Applies the database schema so the database suites never have to (and
 * cannot deadlock each other doing it). With no `DATABASE_URL` it does nothing
 * and loads nothing, so a run on a laptop without a database is exactly what it
 * was. The database module is imported only when there is a database, and only
 * here: a test that needs none never touches it.
 */
export default async function setup(project: TestProject): Promise<void> {
  const state = await applySchemaOnce(process.env, async () => {
    const db = await import("../src/db.js");
    return { migrate: db.migrate, end: () => db.pool.end() };
  });
  project.provide("databaseSchema", state);
  if (state.state === "applied") {
    // eslint-disable-next-line no-console
    console.log(`[test setup] database schema applied once, before any test file (${state.ms} ms)`);
  } else if (state.state === "failed") {
    // eslint-disable-next-line no-console
    console.error(`[test setup] DATABASE SCHEMA NOT APPLIED: ${state.failure}`);
  }
}
