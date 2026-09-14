/**
 * Postgres access, and the one transaction shape every game action uses.
 *
 * The interesting part of this file is `withLeague`. Everything else is
 * plumbing.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

import type { LeagueState } from "@/domain";

const { Pool } = pg;

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/nfl_franchise";
// Managed Postgres (Neon, Render, Supabase, ...) requires TLS and presents a
// cert chain `pg` won't validate out of the box; a developer's own localhost
// never does. `rejectUnauthorized: false` still encrypts the connection —
// what it skips is verifying the CA, which is a reasonable trade for a
// single small hobby database and not one worth a bundled root-cert file for.
const isLocal = /^postgres(ql)?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(url);

export const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // a small league server; the default of 10 is already generous
  max: Number(process.env.DB_POOL_MAX ?? 8),
});

export async function migrate(): Promise<void> {
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export interface LeagueRow {
  id: string;
  name: string;
  commissioner: string;
  inviteCode: string;
  phaseTimeoutHours: number;
  pickTimeoutHours: number;
}

export interface LoadedLeague {
  league: LeagueRow;
  state: LeagueState;
  version: string;
  phaseEndsAt: Date | null;
}

/** What an action hands back: the state it wants persisted, plus what to log. */
export interface Applied {
  state: LeagueState;
  /** Omit to leave the current deadline alone; a Date replaces it, null clears it. */
  phaseEndsAt?: Date | null | undefined;
  events?:
    | { teamCode?: string | undefined; kind: string; summary: string; detail?: unknown }[]
    | undefined;
}

/**
 * Called after a league's transaction commits, with its new version.
 *
 * This exists so the SSE stream can tell an open tab the instant something
 * lands, without `db.ts` knowing what a stream is. Listeners run after
 * COMMIT and must not throw — a broken notifier is not a reason to fail an
 * action that already succeeded.
 */
type CommitListener = (leagueId: string, version: string) => void;
const commitListeners = new Set<CommitListener>();

export function onLeagueCommit(fn: CommitListener): () => void {
  commitListeners.add(fn);
  return () => commitListeners.delete(fn);
}

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Runs one game action against a league, under a row lock.
 *
 * This is the whole concurrency story, and it is deliberately boring. Every
 * mutating endpoint goes through here:
 *
 *   1. `SELECT … FOR UPDATE` takes a lock on the league's row. A second
 *      writer blocks here rather than racing.
 *   2. `apply` receives the state as it is *right now*, not as the client
 *      last saw it, and re-runs the same legality checks the client ran.
 *   3. The write asserts the version it read. Belt and braces with the lock,
 *      but it also catches a stale client that sent an action computed
 *      against a state that has since moved.
 *
 * Two GMs bidding on the same free agent seconds apart is the case this
 * exists for: the second one's cap check runs after the first one's signing
 * is committed, sees the money already spent, and is refused — rather than
 * both succeeding and leaving the team $30M over.
 *
 * `expectedVersion` is what the client believed; omit it for actions where
 * a stale view is harmless (readying up) and pass it where it isn't
 * (anything that spends money or moves a player).
 */
export async function withLeague<T>(
  leagueId: string,
  apply: (loaded: LoadedLeague, client: pg.PoolClient) => Promise<{ result: T } & Applied>,
  opts: { expectedVersion?: string | undefined; actorUserId?: string | undefined } = {},
): Promise<{ result: T; version: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query<{
      state: LeagueState;
      version: string;
      phase_ends_at: Date | null;
      name: string;
      commissioner: string;
      invite_code: string;
      phase_timeout_hours: number;
      pick_timeout_hours: number;
    }>(
      `SELECT s.state, s.version, s.phase_ends_at,
              l.name, l.commissioner, l.invite_code,
              l.phase_timeout_hours, l.pick_timeout_hours
         FROM league_state s JOIN leagues l ON l.id = s.league_id
        WHERE s.league_id = $1
        FOR UPDATE OF s`,
      [leagueId],
    );
    const row = rows.rows[0];
    if (!row) throw new ActionError("No such league.", 404);
    if (opts.expectedVersion != null && opts.expectedVersion !== row.version) {
      throw new ActionError(
        "The league moved on while you were deciding — reload and try again.",
        409,
      );
    }

    const loaded: LoadedLeague = {
      league: {
        id: leagueId,
        name: row.name,
        commissioner: row.commissioner,
        inviteCode: row.invite_code,
        phaseTimeoutHours: row.phase_timeout_hours,
        pickTimeoutHours: row.pick_timeout_hours,
      },
      state: row.state,
      version: row.version,
      phaseEndsAt: row.phase_ends_at,
    };

    const out = await apply(loaded, client);

    const next = out.state;
    const updated = await client.query<{ version: string }>(
      `UPDATE league_state
          SET state = $2, version = version + 1, season = $3, stage = $4, week = $5,
              phase_ends_at = $6, updated_at = now()
        WHERE league_id = $1 AND version = $7
        RETURNING version`,
      [
        leagueId,
        next,
        next.season,
        next.stage,
        next.week,
        out.phaseEndsAt === undefined ? loaded.phaseEndsAt : out.phaseEndsAt,
        row.version,
      ],
    );
    const newVersion = updated.rows[0]?.version;
    if (!newVersion) throw new ActionError("Another change landed first — try again.", 409);

    for (const e of out.events ?? []) {
      await client.query(
        `INSERT INTO events (league_id, actor_user, team_code, kind, summary, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leagueId, opts.actorUserId ?? null, e.teamCode ?? null, e.kind, e.summary, e.detail ?? null],
      );
    }

    await client.query("COMMIT");
    for (const fn of commitListeners) {
      try {
        fn(leagueId, newVersion);
      } catch {
        // a notifier is not allowed to undo a committed action
      }
    }
    return { result: out.result, version: newVersion };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Read-only view of a league, for screens that aren't changing anything. */
export async function readLeague(leagueId: string): Promise<LoadedLeague | null> {
  const rows = await pool.query(
    `SELECT s.state, s.version, s.phase_ends_at,
            l.name, l.commissioner, l.invite_code,
            l.phase_timeout_hours, l.pick_timeout_hours
       FROM league_state s JOIN leagues l ON l.id = s.league_id
      WHERE s.league_id = $1`,
    [leagueId],
  );
  const row = rows.rows[0];
  if (!row) return null;
  return {
    league: {
      id: leagueId,
      name: row.name,
      commissioner: row.commissioner,
      inviteCode: row.invite_code,
      phaseTimeoutHours: row.phase_timeout_hours,
      pickTimeoutHours: row.pick_timeout_hours,
    },
    state: row.state,
    version: row.version,
    phaseEndsAt: row.phase_ends_at,
  };
}
