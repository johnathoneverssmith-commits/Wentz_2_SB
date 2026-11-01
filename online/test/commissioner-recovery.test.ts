import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { pool } from "../src/db.js";
import { franchiseOf } from "../src/auth.js";
import { claimTeam, createOnlineLeague, pauseLeague, resumeLeague, transferCommissioner, vacateSeat } from "../src/leagues.js";
import { forceAdvance, readyUp, sweep, takeTurnForAbsent } from "../src/phases.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * Commissioner recovery: pause / resume, and that a pause is real.
 *
 * A paused league moves for nobody: not a GM's check-in, not a forced advance,
 * not the staff taking a turn, not the clock sweep. Recovery controls (vacate,
 * reassign, hand over the role, resume) still work, and a vacate while paused
 * does not advance the league. Every control is audited with who pressed it.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`rec_comm_${stamp}`, `rec_gm_${stamp}`, `rec_new_${stamp}`] as const;
let leagueId = "";

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
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
  leagueId = (await createOnlineLeague(users[0], { name: "Recovery Test", humanSlots: 2 })).leagueId;
  await claimTeam(leagueId, users[0], "GB");
  await claimTeam(leagueId, users[1], "KC");
});

afterAll(async () => {
  if (reachable) {
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    for (const u of users) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

const row = async () =>
  (await pool.query<{ state: LeagueState; version: string; phase_ends_at: Date | null }>(
    `SELECT state, version, phase_ends_at FROM league_state WHERE league_id = $1`,
    [leagueId],
  )).rows[0]!;
const events = async (kind: string) =>
  (await pool.query<{ actor_user: string | null; summary: string }>(
    `SELECT actor_user, summary FROM events WHERE league_id = $1 AND kind = $2 ORDER BY id`,
    [leagueId, kind],
  )).rows;

describe("pausing a league", () => {
  maybe("only the commissioner can pause or resume", async () => {
    await expect(pauseLeague(leagueId, users[1])).rejects.toThrow(/Only the commissioner/);
    await expect(resumeLeague(leagueId, users[0])).rejects.toThrow(/isn't paused/);
    expect((await row()).state.pause).toBeUndefined();
  });

  maybe("freezes the clock, records who did it, and is not repeatable", async () => {
    // give the phase a real deadline so there is something to freeze
    await pool.query(`UPDATE league_state SET phase_ends_at = now() + interval '3 hours' WHERE league_id = $1`, [leagueId]);
    await pauseLeague(leagueId, users[0]);
    const r = await row();
    expect(r.state.pause?.by).toBe(users[0]);
    expect(r.phase_ends_at, "a paused league has no running clock").toBeNull();
    expect(r.state.pause!.remainingMs!).toBeGreaterThan(2.9 * 3600_000);
    await expect(pauseLeague(leagueId, users[0])).rejects.toThrow(/already paused/);
    expect(await events("league.paused")).toEqual([expect.objectContaining({ actor_user: users[0] })]);
  });

  maybe("moves for nobody while paused: check-in, forced advance, staff turn, sweep", async () => {
    const before = await row();
    const gm = before.state.gms.find((g) => g.teamCode === "KC")!;
    await expect(readyUp(leagueId, gm.id, true, before.state.stage)).rejects.toThrow(/paused/);
    await expect(forceAdvance(leagueId, users[0], before.state.stage)).rejects.toThrow(/paused/);
    await expect(takeTurnForAbsent(leagueId, users[0])).rejects.toThrow(/paused/);
    // an overdue deadline would normally fire the sweep; with no clock there is none
    await sweep();
    const after = await row();
    expect(after.version, "nothing was written").toBe(before.version);
    expect(after.state.stage).toBe(before.state.stage);
  });

  maybe("recovery still works while paused, and a vacate does not advance the league", async () => {
    const before = await row();
    await vacateSeat(leagueId, users[0], "KC");
    expect(await franchiseOf(leagueId, users[1])).toBeNull();
    const mid = await row();
    expect(mid.state.stage).toBe(before.state.stage);
    expect(mid.state.pause, "still paused").toBeDefined();
    expect((await events("league.vacated")).at(-1)!.actor_user, "audited with who did it").toBe(users[0]);
    // reassign to someone else, and hand the role on, both while paused
    await claimTeam(leagueId, users[2], "KC");
    await transferCommissioner(leagueId, users[0], "KC");
    expect((await events("league.commissioner")).at(-1)!.actor_user).toBe(users[0]);
    // the old commissioner has no pause authority any more
    await expect(resumeLeague(leagueId, users[0])).rejects.toThrow(/Only the commissioner/);
    await transferCommissioner(leagueId, users[2], "GB");
  });

  maybe("resume restores the remaining clock; two simultaneous resumes apply once", async () => {
    const results = await Promise.allSettled([resumeLeague(leagueId, users[0]), resumeLeague(leagueId, users[0])]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const r = await row();
    expect(r.state.pause).toBeUndefined();
    expect(r.phase_ends_at).not.toBeNull();
    const left = r.phase_ends_at!.getTime() - Date.now();
    expect(left).toBeGreaterThan(2.5 * 3600_000);
    expect(left).toBeLessThanOrEqual(3 * 3600_000);
    expect(await events("league.resumed")).toHaveLength(1);
  });
});
