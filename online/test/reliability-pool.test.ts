import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db.ts reads the pool size at import, so it has to be set before it loads.
// 4 is the production default (8) scaled to this test's 4 contending writers.
vi.hoisted(() => {
  process.env.DB_POOL_MAX = "4";
});

import { pool, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * One league's long transaction must not stall the server.
 *
 * `withLeague` takes a pool connection FIRST and only then blocks on the
 * league's row lock, and a stage that opens a block of games runs the whole
 * simulation inside that transaction (`runBlockJobs`, tens of seconds on a
 * small host). Every action that arrives for that league meanwhile parks on a
 * connection of its own. Once the parked writers equal the pool size, every
 * other query in the process (another league's action, a poll, a login, the
 * sweep) queues behind them.
 *
 * Needs a real PostgreSQL: see reliability-audit.test.ts.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const user = `rp_${stamp}`;
let busy = "";
let other = "";

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  await pool.query(
    `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y')`,
    [user],
  );
  busy = (await createOnlineLeague(user, { name: "Busy" })).leagueId;
  other = (await createOnlineLeague(user, { name: "Quiet" })).leagueId;
  await claimTeam(busy, user, "GB");
});

afterAll(async () => {
  if (reachable) {
    for (const id of [busy, other]) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe("a long league transaction", () => {
  it.fails(
    url ? "DEFECT blocks an unrelated league's query once the waiting writers fill the pool" : "DEFECT — SKIPPED, no DATABASE_URL",
    async () => {
      if (!reachable) throw new Error("skipped: no database");
      const HOLD_MS = 2500;
      // the "block sim": holds the row lock and a connection
      const holder = withLeague(busy, async ({ state }) => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        return { result: null, state };
      });
      await new Promise((r) => setTimeout(r, 200)); // let it take the lock
      // three GMs press something in that league meanwhile
      const waiters = Array.from({ length: 3 }, () => withLeague(busy, async ({ state }) => ({ result: null, state, unchanged: true })));
      await new Promise((r) => setTimeout(r, 200));

      // a different league's poll, which needs no lock at all
      const t0 = Date.now();
      await pool.query(`SELECT version FROM league_state WHERE league_id = $1`, [other]);
      const waited = Date.now() - t0;

      await Promise.all([holder, ...waiters]);
      expect(waited, "an unrelated read should not wait on another league's simulation").toBeLessThan(500);
    },
  );
});
