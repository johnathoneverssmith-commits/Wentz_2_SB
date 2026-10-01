import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isCommissioner } from "../src/auth.js";
import { migrate, pool } from "../src/db.js";
import { claimCommissioner, claimTeam, commissionerAway, createOnlineLeague, touchSeen } from "../src/leagues.js";

/**
 * A commissioner who simply disappears — never handing the role on — left a
 * league no one could move past a stuck check-in. After a week with no visit
 * and no action from them, any GM holding a team can take the role.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`away_a_${stamp}`, `away_b_${stamp}`, `away_c_${stamp}`] as const;
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
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [u],
    );
  }
  leagueId = (await createOnlineLeague(users[0], { name: "Away Test", humanSlots: 2 })).leagueId;
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

/** Push the league and everything the commissioner did back by `days`. */
async function age(days: number): Promise<void> {
  await pool.query(`UPDATE leagues SET created_at = now() - make_interval(days => $2) WHERE id = $1`, [leagueId, days]);
  await pool.query(`UPDATE events SET at = now() - make_interval(days => $2) WHERE league_id = $1`, [leagueId, days]);
  await pool.query(
    `UPDATE franchises SET last_seen_at = now() - make_interval(days => $2) WHERE league_id = $1 AND last_seen_at IS NOT NULL`,
    [leagueId, days],
  );
}

describe("taking over from a commissioner who has gone", () => {
  maybe("not while the commissioner is around", async () => {
    await touchSeen(leagueId, users[0]);
    expect(await commissionerAway(leagueId)).toBe(false);
    await expect(claimCommissioner(leagueId, users[1])).rejects.toThrow(/been around/);
  });

  maybe("a recent visit alone keeps the role, even with old actions", async () => {
    await age(10);
    await pool.query(`UPDATE franchises SET last_seen_at = now() WHERE league_id = $1 AND user_id = $2`, [leagueId, users[0]]);
    expect(await commissionerAway(leagueId)).toBe(false);
  });

  maybe("only someone holding a team, and not the commissioner themself", async () => {
    await age(10);
    expect(await commissionerAway(leagueId)).toBe(true);
    await expect(claimCommissioner(leagueId, users[2])).rejects.toThrow(/don't have a team/);
    await expect(claimCommissioner(leagueId, users[0])).rejects.toThrow(/already/);
  });

  maybe("after a week away, another GM takes the role and the league is told", async () => {
    await age(10);
    await claimCommissioner(leagueId, users[1]);
    expect(await isCommissioner(leagueId, users[1])).toBe(true);
    expect(await isCommissioner(leagueId, users[0])).toBe(false);
    const ev = await pool.query<{ summary: string }>(
      `SELECT summary FROM events WHERE league_id = $1 AND kind = 'league.commissioner' ORDER BY at DESC LIMIT 1`,
      [leagueId],
    );
    expect(ev.rows[0]?.summary).toMatch(/took over as commissioner/);
    // the new commissioner just acted, so the role can't bounce straight back
    expect(await commissionerAway(leagueId)).toBe(false);
  });
});
