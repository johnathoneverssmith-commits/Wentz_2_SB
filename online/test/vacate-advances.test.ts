import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { migrate, pool } from "../src/db.js";
import { claimTeam, createOnlineLeague, vacateSeat } from "../src/leagues.js";
import { readyUp } from "../src/phases.js";

/**
 * Everyone else had checked in and the league was waiting only on one GM.
 * The commissioner opened that GM's seat — and the league sat there, because
 * nothing would press "ready" again. Opening the seat now moves it on.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`va_a_${stamp}`, `va_b_${stamp}`, `va_c_${stamp}`] as const;
let leagueId = "";
const gm: Record<string, string> = {};

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
  leagueId = (await createOnlineLeague(users[0], { name: "Vacate Advance", humanSlots: 3 })).leagueId;
  gm.GB = (await claimTeam(leagueId, users[0], "GB")).gmId;
  gm.KC = (await claimTeam(leagueId, users[1], "KC")).gmId;
  gm.PIT = (await claimTeam(leagueId, users[2], "PIT")).gmId;
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

const stageOf = async () =>
  (await pool.query<{ state: LeagueState }>(`SELECT state FROM league_state WHERE league_id = $1`, [leagueId]))
    .rows[0]!.state.stage;

describe("opening the seat of the one GM holding up a check-in", () => {
  maybe("moves the league on", async () => {
    // a stage that waits on check-ins (setup itself also waits on open seats)
    await pool.query(
      `UPDATE league_state SET state = jsonb_set(state, '{stage}', '"fantasyDraftSummary"') WHERE league_id = $1`,
      [leagueId],
    );
    const waitingStage = await stageOf();

    await readyUp(leagueId, gm.GB!, true);
    await readyUp(leagueId, gm.KC!, true);
    expect(await stageOf(), "still waiting on PIT").toBe(waitingStage);

    await vacateSeat(leagueId, users[0], "PIT");
    expect(await stageOf()).not.toBe(waitingStage);
  });

  maybe("does not move it when the others haven't checked in", async () => {
    const before = await stageOf();
    await claimTeam(leagueId, users[2], "PIT");
    await vacateSeat(leagueId, users[0], "PIT");
    expect(await stageOf()).toBe(before);
  });
});
