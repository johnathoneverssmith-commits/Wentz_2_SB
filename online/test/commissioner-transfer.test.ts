import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { isCommissioner } from "../src/auth.js";
import { migrate, pool } from "../src/db.js";
import { claimTeam, createOnlineLeague, leaveLeague, transferCommissioner } from "../src/leagues.js";

/**
 * A commissioner who stops playing used to strand the league: nobody else
 * could force a stuck check-in or reopen a seat, and the commissioner can't
 * leave. They can now hand the role to another GM.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`com_a_${stamp}`, `com_b_${stamp}`] as const;
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
  leagueId = (await createOnlineLeague(users[0], { name: "Transfer Test", humanSlots: 2 })).leagueId;
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

describe("handing over the commissioner role", () => {
  maybe("only the commissioner can, and only to someone holding a team", async () => {
    await expect(transferCommissioner(leagueId, users[1], "GB")).rejects.toThrow(/Only the commissioner/);
    await expect(transferCommissioner(leagueId, users[0], "DAL")).rejects.toThrow(/Nobody holds/);
    await expect(transferCommissioner(leagueId, users[0], "GB")).rejects.toThrow(/already/);
  });

  maybe("moves the role, after which the old commissioner can leave", async () => {
    await transferCommissioner(leagueId, users[0], "KC");
    expect(await isCommissioner(leagueId, users[1])).toBe(true);
    expect(await isCommissioner(leagueId, users[0])).toBe(false);
    await leaveLeague(leagueId, users[0]);
  });
});
