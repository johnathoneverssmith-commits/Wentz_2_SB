import { spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { beginDraft } from "@/state/rules.ts";
import { fillRosterGaps } from "@/state/seed.ts";

import { saveGamePlan, actorFor, proposeTrade } from "../src/actions.js";
import { ActionError, pool, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague, vacateSeat } from "../src/leagues.js";
import { forceAdvance, readyUp, sweep } from "../src/phases.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * Multiplayer reliability audit — controlled failure scenarios against a real
 * database (see docs/MULTIPLAYER_RELIABILITY_AUDIT.md for the write-up).
 *
 * Two kinds of test live here:
 *
 *   `maybe`      a safeguard that holds today. A regression turns it red.
 *   `knownDefect` a confirmed defect, written as the behaviour we WANT and
 *                 wrapped in `it.fails`: green while the defect exists, and it
 *                 turns RED the day someone fixes it, which is the cue to
 *                 flip it to a plain `maybe`. Nothing here changes server code.
 *
 * Needs PostgreSQL. Lock contention is only real against a real server:
 * PGlite (`npm run online:db`) runs every socket through one session, so the
 * "simultaneous" tests below degrade to serial ones there.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`ra_a_${stamp}`, `ra_b_${stamp}`, `ra_c_${stamp}`] as const;
const made: string[] = [];

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  if (process.env.DB_POOL_MAX === "1") {
    throw new Error(
      "This suite needs real concurrent connections (a pool of 1 would deadlock it). Run it against PostgreSQL without DB_POOL_MAX=1.",
    );
  }
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
});

afterAll(async () => {
  if (reachable) {
    for (const id of made) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    for (const u of users) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

/** A confirmed defect: asserts the desired behaviour, expected to fail today. */
const knownDefect = (name: string, fn: () => Promise<void>) =>
  it.fails(url ? `DEFECT ${name}` : `DEFECT ${name} — SKIPPED, no DATABASE_URL`, async () => {
    // when the database is absent `it.fails` needs a throw to stay green
    if (!reachable) throw new Error("skipped: no database");
    await fn();
  });

interface Fixture {
  id: string;
  gm: { GB: string; KC: string; PIT: string };
}

/** A fresh 3-GM league, all seats claimed, GB commissioner. */
async function makeLeague(): Promise<Fixture> {
  const { leagueId } = await createOnlineLeague(users[0], { name: "Reliability", humanSlots: 3 });
  made.push(leagueId);
  const GB = (await claimTeam(leagueId, users[0], "GB")).gmId;
  const KC = (await claimTeam(leagueId, users[1], "KC")).gmId;
  const PIT = (await claimTeam(leagueId, users[2], "PIT")).gmId;
  return { id: leagueId, gm: { GB, KC, PIT } };
}

/** Put the league on a stage that waits on check-ins (the same trick vacate-advances uses). */
async function setStage(id: string, stage: string): Promise<void> {
  await pool.query(
    `UPDATE league_state SET state = jsonb_set(state, '{stage}', to_jsonb($2::text)), version = version + 1
      WHERE league_id = $1`,
    [id, stage],
  );
}

const snapshot = async (id: string) => {
  const r = await pool.query<{ state: LeagueState; version: string }>(
    `SELECT state, version FROM league_state WHERE league_id = $1`,
    [id],
  );
  return { state: r.rows[0]!.state, version: Number(r.rows[0]!.version) };
};
const eventCount = async (id: string, kind: string) =>
  Number((await pool.query(`SELECT count(*) FROM events WHERE league_id = $1 AND kind = $2`, [id, kind])).rows[0].count);

describe("simultaneous decisions", () => {
  maybe("the last two GMs readying at the same instant move the stage exactly once", async () => {
    const f = await makeLeague();
    await setStage(f.id, "fantasyDraftSummary");
    await readyUp(f.id, f.gm.GB, true, "fantasyDraftSummary");
    const [a, b] = await Promise.all([
      readyUp(f.id, f.gm.KC, true, "fantasyDraftSummary"),
      readyUp(f.id, f.gm.PIT, true, "fantasyDraftSummary"),
    ]);
    // one of them opened the gate; the other ran after and saw the new stage
    expect([a.moved, b.moved].filter(Boolean)).toHaveLength(1);
    expect(await eventCount(f.id, "phase.advanced")).toBe(1);
  });

  maybe("one GM mashing ready ten times in parallel changes the league once", async () => {
    const f = await makeLeague();
    await setStage(f.id, "fantasyDraftSummary");
    const before = (await snapshot(f.id)).version;
    await Promise.all(Array.from({ length: 10 }, () => readyUp(f.id, f.gm.GB, true, "fantasyDraftSummary")));
    expect((await snapshot(f.id)).version).toBe(before + 1);
  });
});

describe("stale clients", () => {
  maybe("a ready sent for a stage the league has already left is ignored", async () => {
    const f = await makeLeague();
    await setStage(f.id, "fantasyDraftSummary");
    for (const g of [f.gm.GB, f.gm.KC, f.gm.PIT]) await readyUp(f.id, g, true, "fantasyDraftSummary");
    const after = await snapshot(f.id);
    expect(after.state.stage).not.toBe("fantasyDraftSummary");
    // a tab still on the old screen presses ready late
    const late = await readyUp(f.id, f.gm.KC, true, "fantasyDraftSummary");
    expect(late.moved).toBe(false);
    const now = await snapshot(f.id);
    expect(now.version).toBe(after.version);
    expect(now.state.readiness[f.gm.KC]).toBe(false);
  });

  knownDefect("a ready that omits `stage` commits the GM to whatever stage is current", async () => {
    // The route takes `stage` as optional (`optional<string>(ctx, "stage")`). The
    // shipped client always sends it, but a cached older bundle, a second
    // client or a script does not, and gets the stale-ready bug the parameter
    // was added to fix. Desired: refuse (or ignore) a ready that names no stage.
    const f = await makeLeague();
    await setStage(f.id, "fantasyDraftSummary");
    for (const g of [f.gm.GB, f.gm.KC, f.gm.PIT]) await readyUp(f.id, g, true, "fantasyDraftSummary");
    const after = await snapshot(f.id);
    await readyUp(f.id, f.gm.KC, true); // no stage
    expect((await snapshot(f.id)).state.readiness[f.gm.KC]).toBe(false);
    void after;
  });

  maybe("an expectedVersion from before another GM's commit is refused with 409", async () => {
    const f = await makeLeague();
    const { version: v0 } = await withLeague(f.id, async ({ state }) => ({ result: null, state }));
    await withLeague(f.id, async ({ state }) => ({ result: null, state })); // someone else commits
    const err = await withLeague(f.id, async ({ state }) => ({ result: null, state }), {
      expectedVersion: v0,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect((err as ActionError).status).toBe(409);
  });

  knownDefect("a commissioner's force-advance carries no stage, so a double press skips a whole stage", async () => {
    // `POST /admin/advance` sends `{}`; `forceAdvance` advances whatever stage
    // is current. A double click, a retry after a dropped response, or a
    // commissioner tab that is a stage behind moves the league two (or more)
    // steps, skipping everything in between for every GM.
    const once = await makeLeague();
    const twice = await makeLeague();
    await setStage(once.id, "fantasyDraftSummary");
    await setStage(twice.id, "fantasyDraftSummary");
    await forceAdvance(once.id, users[0]);
    await Promise.allSettled([forceAdvance(twice.id, users[0]), forceAdvance(twice.id, users[0])]);
    expect((await snapshot(twice.id)).state.stage).toBe((await snapshot(once.id)).state.stage);
  });
});

describe("a seat that changed hands under an in-flight request", () => {
  knownDefect("an action resolved for a GM before their seat was vacated is still applied afterwards", async () => {
    // `actorFor` reads the seat OUTSIDE the transaction; nothing inside
    // `withLeague` re-checks it. A request queued behind a long block sim
    // (which holds the league lock for the whole simulation) can therefore
    // execute after the commissioner has removed that GM — acting on a CPU
    // team, or on the new GM who claimed the seat (same gmId).
    const f = await makeLeague();
    const stale = await actorFor(f.id, users[1]); // KC's request, resolved
    await vacateSeat(f.id, users[0], "KC"); // seat removed before it runs
    await expect(saveGamePlan(stale, { passRate: 0.9 })).rejects.toBeInstanceOf(ActionError);
    expect((await snapshot(f.id)).state.gamePlans?.KC).toBeUndefined();
  });
});

describe("repeated requests", () => {
  maybe("a duplicate claim of the same team yields one seat", async () => {
    const f = await makeLeague();
    const err = await claimTeam(f.id, users[0], "DAL").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionError); // already has a team
    const rows = await pool.query(`SELECT 1 FROM franchises WHERE league_id = $1 AND user_id = $2`, [f.id, users[0]]);
    expect(rows.rowCount).toBe(1);
  });

  knownDefect("a double-submitted trade offer to a human GM creates two live offers", async () => {
    // The id is `trade_${Date.now()}_${team}` and nothing compares the new
    // offer with an identical open one, so a retried request (or a double
    // click) puts two copies in the partner's inbox.
    const f = await makeLeague();
    // a new league has no rosters until its draft: give every team one
    const { state } = await snapshot(f.id);
    fillRosterGaps(state);
    state.stage = "offseasonDepthChart";
    await pool.query(
      `UPDATE league_state SET state = $2, stage = $3, version = version + 1 WHERE league_id = $1`,
      [f.id, JSON.stringify(state), state.stage],
    );
    const pick = (team: string) =>
      Object.values(state.players)
        .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent && p.position === "WR")
        .sort((a, b) => a.overall - b.overall)[0]!;
    const mine = pick("GB");
    const theirs = pick("KC");
    const a = await actorFor(f.id, users[0]);
    const results = await Promise.allSettled([
      proposeTrade(a, "KC", [mine.id], [theirs.id]),
      proposeTrade(a, "KC", [mine.id], [theirs.id]),
    ]);
    // if the stage refused trading outright this scenario proves nothing
    expect(results.some((r) => r.status === "fulfilled"), JSON.stringify(results)).toBe(true);
    const offered = (await snapshot(f.id)).state.trades.filter(
      (t) => t.status === "offered" && t.fromTeam === "GB" && t.toTeam === "KC",
    );
    expect(offered).toHaveLength(1);
  });
});

describe("sweeps", () => {
  /** A fantasy draft with the three humans first in line, and an expired clock. */
  async function expiredDraft(): Promise<Fixture> {
    const f = await makeLeague();
    const loaded = await snapshot(f.id);
    const s = loaded.state;
    s.stage = "fantasyDraft";
    beginDraft(s, "fantasy");
    s.draft!.pickOrder = ["GB", "KC", "PIT", "GB", "KC", "PIT"];
    s.draft!.currentPickIndex = 0;
    s.draft!.results = [];
    await pool.query(
      `UPDATE league_state SET state = $2, stage = 'fantasyDraft', version = version + 1,
              phase_ends_at = now() - interval '1 minute' WHERE league_id = $1`,
      [f.id, JSON.stringify(s)],
    );
    return f;
  }
  const picksMade = async (id: string) => (await snapshot(id)).state.draft?.results.length ?? 0;

  maybe("one sweep takes only the pick of the GM whose clock ran out", async () => {
    const f = await expiredDraft();
    await sweep();
    expect(await picksMade(f.id)).toBe(1); // GB's; KC now has a fresh clock
  });

  maybe("two overlapping sweeps do not also take the NEXT GM's pick (D3, fixed)", async () => {
    // `sweep` lists expired leagues BEFORE it takes the row lock and never
    // re-checks `phase_ends_at` inside it, so the doc comment's promise that
    // "a second sweeper finds nothing to do" is not true. Overlap happens when
    // a sweep outlasts the 60 s interval (it plays block sims), on the
    // start-up sweep, and during a Render deploy when two instances run at once.
    const f = await expiredDraft();
    await Promise.all([sweep(), sweep()]);
    expect(await picksMade(f.id)).toBe(1);
  });
});

describe("crash and connection loss inside a transaction", () => {
  maybe("a handler that throws after moving the stage leaves the league exactly as it was", async () => {
    const f = await makeLeague();
    await setStage(f.id, "fantasyDraftSummary");
    const before = await snapshot(f.id);
    await expect(
      withLeague(f.id, async ({ state }) => {
        state.stage = "coachingDraft";
        state.readiness[f.gm.GB] = true;
        throw new Error("process died here");
      }),
    ).rejects.toThrow("process died here");
    const after = await snapshot(f.id);
    expect(after.version).toBe(before.version);
    expect(after.state.stage).toBe("fantasyDraftSummary");
    expect(after.state.readiness[f.gm.GB]).toBeFalsy();
  });

  maybe("a database connection lost mid-transaction does not take the server process down (D1, fixed)", async () => {
    // A client checked out of the pool has no 'error' listener (pg-pool removes
    // its idle listener on checkout, and `withLeague` adds none), so a dropped
    // connection (database restart or failover, idle-in-transaction timeout
    // while a block sim holds the lock, a network blip) is an uncaught
    // exception: every league on the server goes down, not just this request.
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", "--conditions", "", "test/helpers/connection-loss-child.ts"],
      {
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.json" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(child.stdout, child.stderr.slice(-400)).toContain("SURVIVED");
    expect(child.status).toBe(0);
  });
});
