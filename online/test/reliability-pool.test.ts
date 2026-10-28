import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// db.ts reads the pool size at import, so it has to be set before it loads.
// 4 is the production default (8) scaled to this test's 4 contending writers.
vi.hoisted(() => {
  process.env.DB_POOL_MAX = "4";
});

import { ActionError, pool, queuedWriters, withLeague } from "../src/db.js";
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
  it(
    url ? "does not block an unrelated league's query once GMs queue behind it (D2, fixed)" : "D2 — SKIPPED, no DATABASE_URL",
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

describe("the per-league writer queue", () => {
  const hold = (id: string, ms: number, log?: string[], tag?: string) =>
    withLeague(id, async ({ state }) => {
      await new Promise((r) => setTimeout(r, ms));
      if (log && tag) log.push(tag);
      return { result: tag ?? null, state, unchanged: true };
    });
  const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("holds one connection for a busy league however many writers queue, and serves them in order", async () => {
    if (!reachable) return;
    const log: string[] = [];
    const first = hold(busy, 600, log, "1");
    await tick(100);
    const rest = ["2", "3", "4", "5", "6", "7"].map((t) => hold(busy, 10, log, t));
    await tick(100);
    expect(queuedWriters(busy)).toBe(6);
    // 4 pool connections, 6 queued writers: another league is still served at once
    const t0 = Date.now();
    await withLeague(other, async ({ state }) => ({ result: null, state, unchanged: true }));
    expect(Date.now() - t0).toBeLessThan(400);
    await Promise.all([first, ...rest]);
    expect(log).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(queuedWriters(busy)).toBe(0);
  });

  it("refuses with a 503 when the queue is full, without disturbing those already waiting", async () => {
    if (!reachable) return;
    process.env.LEAGUE_QUEUE_MAX = "2";
    try {
      const running = hold(busy, 700);
      await tick(100);
      const waiting = [hold(busy, 5), hold(busy, 5)];
      await tick(50);
      const overflow = await hold(busy, 5).catch((e: unknown) => e);
      expect(overflow).toBeInstanceOf(ActionError);
      expect((overflow as ActionError).status).toBe(503);
      await Promise.all([running, ...waiting]); // the queued two still complete
    } finally {
      delete process.env.LEAGUE_QUEUE_MAX;
    }
  });

  it("gives up after the wait limit with a 503, leaves the queue, and never runs late", async () => {
    if (!reachable) return;
    process.env.LEAGUE_QUEUE_WAIT_MS = "250";
    try {
      const ran: string[] = [];
      const running = hold(busy, 900);
      await tick(100);
      const impatient = await hold(busy, 5, ran, "late").catch((e: unknown) => e);
      expect((impatient as ActionError).status).toBe(503);
      expect(queuedWriters(busy)).toBe(0);
      await running;
      await tick(100);
      expect(ran).toEqual([]);
    } finally {
      delete process.env.LEAGUE_QUEUE_WAIT_MS;
    }
  });

  it("passes the turn on when a writer fails", async () => {
    if (!reachable) return;
    const boom = withLeague(busy, async () => {
      await tick(100);
      throw new Error("handler failed");
    }).catch((e: unknown) => e);
    await tick(20);
    const next = await hold(busy, 5, undefined, "after");
    expect(next.result).toBe("after");
    expect(((await boom) as Error).message).toBe("handler failed");
    expect(queuedWriters(busy)).toBe(0);
  });
});
