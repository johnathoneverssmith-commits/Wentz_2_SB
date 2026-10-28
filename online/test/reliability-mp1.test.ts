import { spawn } from "node:child_process";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { beginDraft } from "@/state/rules.ts";

import { ActionError, onLeagueCommit, pool, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { readyUp, sweep } from "../src/phases.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * MP-1 (audit D1 and D3) on a real PostgreSQL.
 *
 * D1: a connection that dies inside a league transaction must fail that
 * request cleanly (503, nothing saved), leave the process and every other
 * league running, and let later actions succeed once the database is back.
 *
 * D3: a sweep must act on the deadline as it is under the league lock, so
 * overlapping sweeps — in one process, or in separate processes standing in
 * for two instances during a rolling deploy — apply exactly one turn.
 *
 * Needs PostgreSQL; PGlite serialises every socket and cannot show either.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`mp_a_${stamp}`, `mp_b_${stamp}`, `mp_c_${stamp}`] as const;
const made: string[] = [];
const fn = `mp1_slow_${stamp}`;

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y')`,
      [u],
    );
  }
});
afterAll(async () => {
  if (reachable) {
    await pool.query(`DROP FUNCTION IF EXISTS ${fn}() CASCADE`).catch(() => {});
    for (const id of made) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    for (const u of users) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, body: () => Promise<void>, timeout?: number) =>
  it(
    url ? name : `${name} — SKIPPED, no DATABASE_URL`,
    async () => {
      if (!reachable) return;
      await body();
    },
    timeout,
  );

async function league(): Promise<{ id: string; gm: Record<string, string> }> {
  const { leagueId } = await createOnlineLeague(users[0], { name: "MP1", humanSlots: 3 });
  made.push(leagueId);
  const gm: Record<string, string> = {};
  gm.GB = (await claimTeam(leagueId, users[0], "GB")).gmId;
  gm.KC = (await claimTeam(leagueId, users[1], "KC")).gmId;
  gm.PIT = (await claimTeam(leagueId, users[2], "PIT")).gmId;
  return { id: leagueId, gm };
}
const snap = async (id: string) => {
  const r = await pool.query<{ state: LeagueState; version: string }>(
    `SELECT state, version FROM league_state WHERE league_id = $1`,
    [id],
  );
  return { state: r.rows[0]!.state, version: Number(r.rows[0]!.version) };
};
const events = async (id: string) =>
  Number((await pool.query(`SELECT count(*) FROM events WHERE league_id = $1`, [id])).rows[0].count);
const setStage = (id: string, stage: string) =>
  pool.query(
    `UPDATE league_state SET state = jsonb_set(state, '{stage}', to_jsonb($2::text)), version = version + 1 WHERE league_id = $1`,
    [id, stage],
  );

describe("D1 — a connection lost inside a real action", () => {
  maybe("fails that request with a 503, saves nothing, spares other leagues, and recovers", async () => {
    const a = await league();
    const b = await league(); // an unrelated league on the same server
    await setStage(a.id, "fantasyDraftSummary");
    await setStage(b.id, "fantasyDraftSummary");
    for (const g of [a.gm.GB!, a.gm.KC!]) await readyUp(a.id, g, true, "fantasyDraftSummary");
    const before = await snap(a.id);
    const eventsBefore = await events(a.id);

    // The last ready would advance the stage. Make its UPDATE take a while so
    // there is a window in which to kill the connection it is using.
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $f$
      BEGIN IF NEW.league_id = '${a.id}' THEN PERFORM pg_sleep(3); END IF; RETURN NEW; END $f$ LANGUAGE plpgsql`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON league_state FOR EACH ROW EXECUTE FUNCTION ${fn}()`);

    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    try {
      const doomed = readyUp(a.id, a.gm.PIT!, true, "fantasyDraftSummary").catch((e: unknown) => e);
      await new Promise((r) => setTimeout(r, 800));
      const killed = await admin.query(
        `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'PgSleep' AND query ILIKE 'UPDATE league_state%'`,
      );
      expect(killed.rowCount, "found the connection mid-UPDATE").toBe(1);

      // the other league keeps working while this one is failing
      const other = await readyUp(b.id, b.gm.GB!, true, "fantasyDraftSummary");
      expect(other.moved).toBe(false);

      const err = await doomed;
      expect(err).toBeInstanceOf(ActionError);
      expect((err as ActionError).status).toBe(503);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON league_state`);
      await admin.end();
    }
    await new Promise((r) => setTimeout(r, 500)); // the orphaned backend rolls back

    // no partial mutation: version, stage, readiness and events are as they were
    const after = await snap(a.id);
    expect(after.version).toBe(before.version);
    expect(after.state.stage).toBe("fantasyDraftSummary");
    expect(after.state.readiness[a.gm.PIT!]).toBeFalsy();
    expect(await events(a.id)).toBe(eventsBefore);

    // restored connectivity: the same action now succeeds, once
    const retry = await readyUp(a.id, a.gm.PIT!, true, "fantasyDraftSummary");
    expect(retry.moved).toBe(true);
    expect((await snap(a.id)).state.stage).not.toBe("fantasyDraftSummary");
  });

  maybe("recovers when every pooled connection is killed at once (a database restart)", async () => {
    const a = await league();
    // collect this pool's own backend pids by holding several clients at once
    const held = await Promise.all(Array.from({ length: 4 }, () => pool.connect()));
    const pids = await Promise.all(held.map(async (c) => (await c.query("SELECT pg_backend_pid() AS p")).rows[0].p as number));
    held.forEach((c) => c.release());
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query("SELECT pg_terminate_backend(p) FROM unnest($1::int[]) AS p", [pids]);
    await admin.end();
    await new Promise((r) => setTimeout(r, 300));

    // the first request after the outage may land on a dead pooled client
    // and be refused; the pool must replace it, so a retry succeeds
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) {
      ok = await withLeague(a.id, async ({ state }) => ({ result: true, state, unchanged: true }))
        .then((r) => r.result)
        .catch(() => false);
    }
    expect(ok).toBe(true);
  });
});

describe("D1 — the acknowledgement of a COMMIT is lost", () => {
  maybe("a committed move reports 503 without claiming 'not saved'; a reload reconciles and replays are harmless", async () => {
    const a = await league();
    await setStage(a.id, "fantasyDraftSummary");
    const before = await snap(a.id);
    const heard: string[] = [];
    const off = onLeagueCommit((id, v) => id === a.id && heard.push(v));

    // COMMIT reaches the database and is applied; the connection then dies
    // before the client hears so
    const err = await withLeague(a.id, async ({ state }, client) => {
      state.readiness[a.gm.GB!] = true;
      const real = client.query.bind(client) as (...x: unknown[]) => Promise<unknown>;
      (client as unknown as { query: unknown }).query = async (...x: unknown[]) => {
        const out = await real(...x);
        if (x[0] === "COMMIT") {
          const cause = new Error("Connection terminated unexpectedly");
          (client as unknown as { connection: { stream: { destroy: (e: Error) => void } } }).connection.stream.destroy(cause);
          throw cause;
        }
        return out;
      };
      return { result: null, state };
    }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 500));
    off();

    expect(err).toBeInstanceOf(ActionError);
    expect((err as ActionError).status).toBe(503);
    expect((err as ActionError).message).not.toMatch(/was not saved/i);
    expect((err as ActionError).message).toMatch(/reload/i);

    // it did commit; a fresh read shows it, and open tabs were told to look
    const after = await snap(a.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.state.readiness[a.gm.GB!]).toBe(true);
    expect(heard).toContain(String(after.version));

    // replays: the same ready changes nothing; a version-checked replay is refused
    const replay = await readyUp(a.id, a.gm.GB!, true, "fantasyDraftSummary");
    expect(replay.moved).toBe(false);
    expect((await snap(a.id)).version).toBe(after.version);
    const stale = await withLeague(a.id, async ({ state }) => ({ result: null, state }), {
      expectedVersion: String(before.version),
    }).catch((e: unknown) => e);
    expect((stale as ActionError).status).toBe(409);
  });
});

describe("D3 — overlapping sweeps apply exactly one turn", () => {
  async function expiredDraft() {
    const f = await league();
    const { state } = await snap(f.id);
    state.stage = "fantasyDraft";
    beginDraft(state, "fantasy");
    state.draft!.pickOrder = ["GB", "KC", "PIT", "GB", "KC", "PIT"];
    state.draft!.currentPickIndex = 0;
    state.draft!.results = [];
    await pool.query(
      `UPDATE league_state SET state = $2, stage = 'fantasyDraft', version = version + 1,
              phase_ends_at = now() - interval '1 minute' WHERE league_id = $1`,
      [f.id, JSON.stringify(state)],
    );
    return f;
  }
  const picks = async (id: string) => (await snap(id)).state.draft!.results.length;
  const deadline = async (id: string) =>
    (await pool.query<{ t: Date }>(`SELECT phase_ends_at AS t FROM league_state WHERE league_id = $1`, [id])).rows[0]!.t;

  maybe("six overlapping sweeps in one process take only the expired GM's pick", async () => {
    const f = await expiredDraft();
    await Promise.all(Array.from({ length: 6 }, () => sweep()));
    expect(await picks(f.id)).toBe(1);
    expect((await snap(f.id)).state.draft!.results[0]!.teamCode).toBe("GB");
    expect((await deadline(f.id)).getTime()).toBeGreaterThan(Date.now()); // KC has a fresh clock
  });

  maybe("sweeps from separate processes (two instances) take only one pick", async () => {
    const f = await expiredDraft();
    const startAt = Date.now() + 4000;
    const run = () =>
      new Promise<string>((resolve) => {
        const child = spawn(process.execPath, ["--import", "tsx", "test/helpers/sweep-child.ts"], {
          cwd: new URL("..", import.meta.url).pathname,
          env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json", START_AT: String(startAt), NODE_ENV: "development" },
        });
        let out = "";
        child.stdout.on("data", (d: Buffer) => (out += d));
        child.stderr.on("data", (d: Buffer) => (out += d));
        child.on("close", () => resolve(out));
      });
    const outs = await Promise.all([run(), run()]);
    for (const o of outs) expect(o, o).toContain("SWEPT");
    expect(await picks(f.id)).toBe(1);
  }, 60_000);

  maybe("a sweep leaves a league whose clock has not run out untouched", async () => {
    const f = await expiredDraft();
    await sweep(); // GB's pick; KC's clock is now in the future
    const before = await snap(f.id);
    await sweep();
    const after = await snap(f.id);
    expect(after.version).toBe(before.version);
    expect(after.state.draft!.results).toHaveLength(1);
  });

  maybe("the intended timeout still fires: when KC's clock does run out, KC's pick is taken", async () => {
    const f = await expiredDraft();
    await sweep();
    await pool.query(`UPDATE league_state SET phase_ends_at = now() - interval '1 second' WHERE league_id = $1`, [f.id]);
    await sweep();
    const r = (await snap(f.id)).state.draft!.results.map((x) => x.teamCode);
    expect(r).toEqual(["GB", "KC"]);
  });
});
