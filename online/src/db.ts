/**
 * Postgres access, and the one transaction shape every game action uses.
 *
 * The interesting part of this file is `withLeague`. Everything else is
 * plumbing.
 */
import { readFileSync } from "node:fs";
import pg from "pg";

import type { LeagueState } from "@/domain";
import { upgradeLeagueState } from "@/state/saveMigration.ts";

import { takeBlockJobs } from "./blockJobs.js";
import { takeNotes } from "./notes.js";
import { attentionOf, deliverNudges, nudgesFor, type Attention } from "./push.js";
import { runBlockJobs } from "./simPool.js";

/** Every league read passes through the shared upgrade step (idempotent). */
function upgraded(state: LeagueState): LeagueState {
  upgradeLeagueState(state);
  // A preseason simulated before the injury ledger existed has none, so every
  // GM saw injuries from preseason games they hadn't watched. The preseason
  // is the one block whose start is known without a ledger: the rollover (or
  // a new league) leaves nobody hurt.
  if (
    !state.injuryLedger &&
    (state.stage === "preseason" || state.stage === "leagueDevelopments") &&
    state.games.some((g) => g.phase === "PRE") &&
    !state.games.some((g) => g.phase === "REG")
  ) {
    state.injuryLedger = { phase: "PRE", fromWeek: 1, start: {} };
  }
  return state;
}

const { Pool } = pg;

const url = process.env.DATABASE_URL ?? "postgres://localhost:5432/nfl_franchise";
// Managed Postgres (Neon, Render, Supabase, ...) requires TLS and presents a
// cert chain `pg` won't validate out of the box; a developer's own localhost
// never does. `rejectUnauthorized: false` still encrypts the connection —
// what it skips is verifying the CA, which is a reasonable trade for a
// single small hobby database and not one worth a bundled root-cert file for.
const isLocal = /^postgres(ql)?:\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(url);

export const pool = new Pool({
  connectionString: url,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
  // a small league server; the default of 10 is already generous
  max: Number(process.env.DB_POOL_MAX ?? 8),
});

// An idle client's error (the database restarting, a dropped connection) is
// emitted on the pool, and with no listener Node treats it as fatal: one
// blip took the whole server down, every league with it. The pool discards
// the broken client by itself; all that's needed is not to die.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("database client error (the pool will replace it)", err.message);
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
  /**
   * Nothing changed: roll back instead of writing. A write bumps the version
   * (refusing every other GM's in-flight signing, trade or bid built on the
   * old one) and tells every open tab to re-download the league — for a
   * repeated "ready", once a second while a client kept sending it.
   */
  unchanged?: boolean | undefined;
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
      state: upgraded(row.state),
      version: row.version,
      phaseEndsAt: row.phase_ends_at,
    };

    // who was being asked for what, before this change — so a GM it puts on
    // the clock gets a push (`push.ts`)
    let attentionBefore: Attention | null = null;
    try {
      attentionBefore = attentionOf(loaded.state);
    } catch {
      // notifications are never a reason to refuse an action
    }
    const out = await apply(loaded, client);
    // a stage that opened a block of games queued it rather than playing it
    // on the event loop; play it now, off-thread, before anything is written
    const jobs = takeBlockJobs(out.state);
    const notes = takeNotes(out.state);
    if (jobs.length > 0) out.state = await runBlockJobs(out.state, jobs);
    if (out.unchanged) {
      await client.query("ROLLBACK");
      return { result: out.result, version: row.version };
    }

    const next = out.state;
    // serialised once, here: it is both what gets written and what the
    // league's next readers are handed (see `leagueText`)
    const nextText = JSON.stringify(next);
    const updated = await client.query<{ version: string }>(
      `UPDATE league_state
          SET state = $2, version = version + 1, season = $3, stage = $4, week = $5,
              phase_ends_at = $6, updated_at = now()
        WHERE league_id = $1 AND version = $7
        RETURNING version`,
      [
        leagueId,
        nextText,
        next.season,
        next.stage,
        next.week,
        out.phaseEndsAt === undefined ? loaded.phaseEndsAt : out.phaseEndsAt,
        row.version,
      ],
    );
    const newVersion = updated.rows[0]?.version;
    if (!newVersion) throw new ActionError("Another change landed first — try again.", 409);

    // A fired GM who took a new team (`hotSeat.ts`) changed seats inside the
    // document; the seat table follows it, so every later action finds them
    // on the right team.
    if (next.hotSeat?.entries.some((e) => e.chosen)) {
      for (const gm of next.gms) {
        if (!gm.isHuman || !gm.teamCode) continue;
        await client.query(
          `UPDATE franchises SET team_code = $3
            WHERE league_id = $1 AND gm_id = $2 AND team_code <> $3 AND team_code NOT LIKE 'unclaimed:%'`,
          [leagueId, gm.id, gm.teamCode],
        );
      }
    }

    for (const e of [...(out.events ?? []), ...notes]) {
      await client.query(
        `INSERT INTO events (league_id, actor_user, team_code, kind, summary, detail)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [leagueId, opts.actorUserId ?? null, e.teamCode ?? null, e.kind, e.summary, e.detail ?? null],
      );
    }

    await client.query("COMMIT");
    leagueText.delete(leagueId);
    leagueText.set(leagueId, { version: newVersion, text: nextText });
    if (leagueText.size > LEAGUE_TEXT_KEPT) leagueText.delete(leagueText.keys().next().value!);
    for (const fn of commitListeners) {
      try {
        fn(leagueId, newVersion);
      } catch {
        // a notifier is not allowed to undo a committed action
      }
    }
    if (attentionBefore) {
      try {
        const nudges = nudgesFor(leagueId, row.name, attentionBefore, attentionOf(next), next);
        void deliverNudges(pool, leagueId, nudges).catch(() => {});
      } catch {
        // as above
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
/**
 * The league document as text, by version — the last few leagues read.
 *
 * Every change sends every GM in the league to fetch the same new version,
 * and each fetch pulled ~2MB of JSON out of the database (over the network,
 * from a hosted Postgres) and parsed it. The version is one small column, so
 * a read asks for that first and reuses the text it already has. A version
 * that moved on simply misses.
 */
const leagueText = new Map<string, { version: string; text: string }>();
const LEAGUE_TEXT_KEPT = 16;

export async function readLeague(leagueId: string): Promise<LoadedLeague | null> {
  const meta = await pool.query<{
    version: string;
    phase_ends_at: Date | null;
    name: string;
    commissioner: string;
    invite_code: string;
    phase_timeout_hours: number;
    pick_timeout_hours: number;
  }>(
    `SELECT s.version, s.phase_ends_at,
            l.name, l.commissioner, l.invite_code,
            l.phase_timeout_hours, l.pick_timeout_hours
       FROM league_state s JOIN leagues l ON l.id = s.league_id
      WHERE s.league_id = $1`,
    [leagueId],
  );
  const row = meta.rows[0];
  if (!row) return null;
  let text = leagueText.get(leagueId)?.version === row.version ? leagueText.get(leagueId)!.text : null;
  if (text === null) {
    const doc = await pool.query<{ state: string; version: string }>(
      `SELECT state::text AS state, version FROM league_state WHERE league_id = $1`,
      [leagueId],
    );
    const got = doc.rows[0];
    if (!got) return null;
    text = got.state;
    // the league may have moved between the two reads: keep what was read
    // with the version it was read at
    row.version = got.version;
    leagueText.delete(leagueId);
    leagueText.set(leagueId, { version: got.version, text });
    if (leagueText.size > LEAGUE_TEXT_KEPT) leagueText.delete(leagueText.keys().next().value!);
  }
  return {
    league: {
      id: leagueId,
      name: row.name,
      commissioner: row.commissioner,
      inviteCode: row.invite_code,
      phaseTimeoutHours: row.phase_timeout_hours,
      pickTimeoutHours: row.pick_timeout_hours,
    },
    state: upgraded(JSON.parse(text) as LeagueState),
    version: row.version,
    phaseEndsAt: row.phase_ends_at,
  };
}
