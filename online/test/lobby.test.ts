import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { migrate, pool } from "../src/db.js";
import { claimTeam, createOnlineLeague, leaguesFor } from "../src/leagues.js";

/**
 * The commissioner's first two minutes.
 *
 * This is the path that was broken: you create a league, and then you have to
 * be able to find it again. The list of "your leagues" was built by joining a
 * user to their own franchise row, which the person who just created the
 * league does not have yet — so the league vanished the moment it was made,
 * and the only human guaranteed to be looking at it had no way to claim a
 * team. Every other test passed the whole time, because they all start from a
 * league whose teams are already claimed.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

let reachable = false;
const userId = `lobby_user_${Date.now()}`;
const madeLeagues: string[] = [];

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
  await pool.query(
    `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
     VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
    [userId],
  );
});

afterAll(async () => {
  if (reachable) {
    for (const id of madeLeagues) {
      await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    }
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe("a league you just created", () => {
  const maybe = () => (reachable ? it : it.skip);

  maybe()("comes back in your own league list, before you have a team", async () => {
    const { leagueId, inviteCode } = await createOnlineLeague(userId, {
      name: "Commissioner Test",
      humanSlots: 4,
    });
    madeLeagues.push(leagueId);

    const mine = await leaguesFor(userId);
    const row = mine.find((l) => l.id === leagueId);

    expect(row, "the league you just made must be in your list").toBeDefined();
    // no team yet — this is what tells the UI to offer the claim button
    expect(row!.teamCode).toBeNull();
    expect(row!.isCommissioner).toBe(true);
    // and the code has to survive a reload, or nobody can ever join
    expect(row!.inviteCode).toBe(inviteCode);
  });

  maybe()("still lists you once you claim, now with the team", async () => {
    const { leagueId } = await createOnlineLeague(userId, {
      name: "Claim Test",
      humanSlots: 4,
    });
    madeLeagues.push(leagueId);

    await claimTeam(leagueId, userId, "KC");

    const row = (await leaguesFor(userId)).find((l) => l.id === leagueId);
    expect(row!.teamCode).toBe("KC");
    expect(row!.isCommissioner).toBe(true);
  });

  maybe()("has no human GMs until people actually claim teams", async () => {
    const { leagueId } = await createOnlineLeague(userId, { name: "Phantom Test", humanSlots: 4 });
    madeLeagues.push(leagueId);

    const before = await pool.query<{ state: LeagueState }>(
      `SELECT state FROM league_state WHERE league_id = $1`,
      [leagueId],
    );
    // nobody has claimed, so nobody is a person yet — an unclaimed slot that
    // claims to be human blocks `humanGate` forever
    expect(before.rows[0]!.state.gms.every((g) => !g.isHuman)).toBe(true);

    await claimTeam(leagueId, userId, "KC");

    const after = await pool.query<{ state: LeagueState }>(
      `SELECT state FROM league_state WHERE league_id = $1`,
      [leagueId],
    );
    const gms = after.rows[0]!.state.gms;
    expect(gms.filter((g) => g.isHuman).map((g) => g.teamCode)).toEqual(["KC"]);
    // and the rest are still not people
    expect(gms.filter((g) => g.isHuman)).toHaveLength(1);
  });

  maybe()("puts the claiming account's own name on the GM slot", async () => {
    const { leagueId } = await createOnlineLeague(userId, { name: "Naming Test", humanSlots: 4 });
    madeLeagues.push(leagueId);
    await claimTeam(leagueId, userId, "DEN");

    const row = await pool.query<{ state: LeagueState }>(
      `SELECT state FROM league_state WHERE league_id = $1`,
      [leagueId],
    );
    const mine = row.rows[0]!.state.gms.find((g) => g.teamCode === "DEN");
    // not the seed's invented AI name for whoever held the slot before
    expect(mine!.name).toBe(userId);
  });

  maybe()("does not leak the invite code to a GM who merely joined", async () => {
    const other = `lobby_other_${Date.now()}`;
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
       VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
      [other],
    );
    const { leagueId } = await createOnlineLeague(userId, { name: "Leak Test", humanSlots: 4 });
    madeLeagues.push(leagueId);

    await claimTeam(leagueId, other, "BUF");
    const row = (await leaguesFor(other)).find((l) => l.id === leagueId);

    expect(row!.teamCode).toBe("BUF");
    expect(row!.isCommissioner).toBe(false);
    expect(row!.inviteCode).toBeNull();

    await pool.query(`DELETE FROM users WHERE id = $1`, [other]).catch(() => {});
  });
});
