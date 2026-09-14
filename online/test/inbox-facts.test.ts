import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { createLeague, DEFAULT_CONFIG, fillRosterGaps } from "@/state/seed.ts";

import { migrate, pool } from "../src/db.js";
import { factsFromState, inboxFacts } from "../src/inbox.js";

/**
 * The SQL and the TypeScript must agree, exactly.
 *
 * The inbox stopped reading the whole league document and started asking
 * Postgres the five questions it actually has. That is only a safe trade if
 * the two produce the same answer, and the failure mode if they don't is
 * quiet — a GM who is on the clock and never told, a cap warning that stops
 * appearing. So the reference implementation stays, and this pins the query
 * to it against a real league rather than a fixture.
 *
 * Needs a database; skips loudly without one.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

let reachable = false;
const leagueId = `facts_${Date.now()}`;
let state: LeagueState;

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

  state = createLeague(909, { ...DEFAULT_CONFIG, humanGmCount: 2 });
  fillRosterGaps(state);
  state.gms[0]!.teamCode = "KC";
  state.gms[0]!.isHuman = true;
  state.readiness[state.gms[0]!.id] = false;
  // something in every bucket the inbox reports on
  state.trades.push({
    id: "t1",
    fromTeam: "BUF",
    toTeam: "KC",
    status: "offered",
    fromPlayers: [],
    toPlayers: [],
    fromPicks: [],
    toPicks: [],
  } as never);

  await pool.query(
    `INSERT INTO users (id, name, name_folded, password_hash, password_salt)
     VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
    [leagueId],
  );
  await pool.query(
    `INSERT INTO leagues (id, name, commissioner, invite_code) VALUES ($1, 'Facts', $2, $3)`,
    [leagueId, leagueId, leagueId.slice(-8).toUpperCase()],
  );
  await pool.query(
    `INSERT INTO league_state (league_id, state, season, stage, week)
     VALUES ($1, $2, $3, $4, $5)`,
    [leagueId, state, state.season, state.stage, state.week],
  );
});

afterAll(async () => {
  if (reachable) {
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [leagueId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

describe("inbox facts", () => {
  const maybe = () => (reachable ? it : it.skip);

  maybe()("match the reference implementation exactly", async () => {
    const gmId = state.gms[0]!.id;
    const fromDb = await inboxFacts(leagueId, "KC", gmId);
    const fromMemory = factsFromState(state, "KC", gmId);
    expect(fromDb).toEqual(fromMemory);
  });

  maybe()("agree for a team the user doesn't run", async () => {
    const gmId = state.gms[1]!.id;
    const fromDb = await inboxFacts(leagueId, "BUF", gmId);
    expect(fromDb).toEqual(factsFromState(state, "BUF", gmId));
  });

  maybe()("counts a real roster, not zero", async () => {
    const facts = await inboxFacts(leagueId, "KC", state.gms[0]!.id);
    expect(facts!.rosterCount).toBeGreaterThan(40);
  });
});
