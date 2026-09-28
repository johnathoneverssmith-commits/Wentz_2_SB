import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { franchiseOf } from "../src/auth.js";
import { migrate, pool } from "../src/db.js";
import { claimTeam, createOnlineLeague, openTeams, vacateSeat } from "../src/leagues.js";

/**
 * A GM quits. There was no way to replace them: the league waited a full
 * phase clock on the empty chair at every stage, forever, and nobody new
 * could take the team. The commissioner can now hand it to the CPU and open
 * the seat under the league's invite code.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`vac_comm_${stamp}`, `vac_quit_${stamp}`, `vac_new_${stamp}`] as const;
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
  leagueId = (await createOnlineLeague(users[0], { name: "Vacate Test", humanSlots: 2 })).leagueId;
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

const stateOf = async () =>
  (await pool.query<{ state: LeagueState }>(`SELECT state FROM league_state WHERE league_id = $1`, [leagueId]))
    .rows[0]!.state;

describe("reopening a seat", () => {
  maybe("is the commissioner's to do, and not to their own team", async () => {
    await expect(vacateSeat(leagueId, users[0], "GB")).rejects.toThrow(/your own team/);
    await expect(vacateSeat(leagueId, users[0], "DAL")).rejects.toThrow(/Nobody holds/);
  });

  maybe("hands the team to the CPU and lists it as open", async () => {
    await vacateSeat(leagueId, users[0], "KC");
    expect(await franchiseOf(leagueId, users[1])).toBeNull();
    const s = await stateOf();
    const gm = s.gms.find((g) => g.teamCode === "KC")!;
    expect(gm.isHuman, "the league must stop waiting on them").toBe(false);
    expect(s.teams.KC!.controlledBy.kind).toBe("ai");
    expect(await openTeams(leagueId)).toEqual(["KC"]);
  });

  maybe("lets a newcomer take over that team", async () => {
    const claimed = await claimTeam(leagueId, users[2], "KC");
    expect(claimed.teamCode).toBe("KC");
    const s = await stateOf();
    const gm = s.gms.find((g) => g.id === claimed.gmId)!;
    expect(gm.isHuman).toBe(true);
    expect(gm.name).toBe(users[2]);
    expect(s.teams.KC!.controlledBy).toEqual({ kind: "human", gmId: claimed.gmId });
    expect(await openTeams(leagueId)).toEqual([]);
  });
});
