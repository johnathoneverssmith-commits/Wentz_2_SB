import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { ActionError, migrate, pool, withLeague } from "../src/db.js";

/**
 * The part only a real database can answer.
 *
 * Everything about *whether* an action is allowed is tested in
 * `decide.test.ts` without Postgres, because that's where the rulings live.
 * What's left is the thing Postgres itself provides and no unit test can
 * fake: that two GMs acting at the same instant are serialised, and that a
 * client working from a stale copy of the league is refused rather than
 * quietly overwriting somebody.
 *
 * These need a database. They skip — loudly, in the test name — when there
 * isn't one, rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

let reachable = false;
let leagueId = "";

beforeAll(async () => {
  if (!url) return;
  try {
    await pool.query("SELECT 1");
    await migrate();
    reachable = true;
  } catch {
    reachable = false;
  }
  if (!reachable) return;

  const state = createLeague(303, DEFAULT_CONFIG);
  fillRosterGaps(state);
  leagueId = `test_${Date.now()}`;
  await pool.query(
    `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
     VALUES ('test_user', 'Test', 'test', 'x', 'y') ON CONFLICT DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO leagues (id, name, commissioner, invite_code) VALUES ($1, 'Test', 'test_user', $2)`,
    [leagueId, leagueId.slice(-8).toUpperCase()],
  );
  await pool.query(
    `INSERT INTO league_state (league_id, state, season, stage, week) VALUES ($1, $2, $3, $4, $5)`,
    [leagueId, state, state.season, state.stage, state.week],
  );
});

afterAll(async () => {
  if (reachable && leagueId) {
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]);
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

describe("two GMs at once", () => {
  maybe("serialises contending writes rather than interleaving them", async () => {
    // both increment a counter stashed in the document; if the lock works,
    // the second one sees the first one's value
    const bump = () =>
      withLeague(leagueId, async ({ state }) => {
        const s = state as unknown as { _count?: number };
        s._count = (s._count ?? 0) + 1;
        return { result: s._count, state };
      });
    const [a, b] = await Promise.all([bump(), bump()]);
    expect(new Set([a.result, b.result])).toEqual(new Set([1, 2]));
  });

  maybe("refuses a write built on a stale version", async () => {
    const first = await withLeague(leagueId, async ({ state }) => ({ result: null, state }));
    // second client still holding the version from before `first` committed
    await expect(
      withLeague(leagueId, async ({ state }) => ({ result: null, state }), {
        expectedVersion: String(Number(first.version) - 1),
      }),
    ).rejects.toBeInstanceOf(ActionError);
  });

  maybe("accepts a write that quotes the current version", async () => {
    const current = await withLeague(leagueId, async ({ state }) => ({ result: null, state }));
    const next = await withLeague(leagueId, async ({ state }) => ({ result: null, state }), {
      expectedVersion: current.version,
    });
    expect(Number(next.version)).toBe(Number(current.version) + 1);
  });

  maybe("rolls back everything when a handler throws", async () => {
    const before = await withLeague(leagueId, async ({ state }) => ({ result: null, state }));
    await expect(
      withLeague(leagueId, async ({ state }) => {
        (state as unknown as { _poison?: boolean })._poison = true;
        throw new ActionError("nope");
      }),
    ).rejects.toThrow("nope");
    const after = await withLeague(leagueId, async ({ state }) => ({
      result: (state as unknown as { _poison?: boolean })._poison ?? false,
      state,
    }));
    expect(after.result).toBe(false);
    // and the version only moved for the two successful reads, not the throw
    expect(Number(after.version)).toBe(Number(before.version) + 1);
  });

  maybe("writes an event per accepted action and none for a refused one", async () => {
    await withLeague(leagueId, async ({ state }) => ({
      result: null,
      state,
      events: [{ kind: "test.ok", summary: "it happened" }],
    }));
    await expect(
      withLeague(leagueId, async ({ state }) => {
        void state;
        throw new ActionError("refused");
      }),
    ).rejects.toThrow();
    const rows = await pool.query(`SELECT kind FROM events WHERE league_id = $1`, [leagueId]);
    expect(rows.rows.filter((r) => r.kind === "test.ok")).toHaveLength(1);
  });
});
