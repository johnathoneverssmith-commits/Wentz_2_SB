import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { actorFor, chooseJob } from "../src/actions.js";
import { migrate, pool, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { ensureHotSeat } from "@/state/hotSeat.ts";

/**
 * A fired GM takes a new team: the league document, the seat table and the
 * actions that follow all have to agree on where they now work.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const user = `hs_a_${stamp}`;
let leagueId = "";
let options: string[] = [];

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
    [user],
  );
  leagueId = (await createOnlineLeague(user, { name: "Hot Seat Test", humanSlots: 1 })).leagueId;
  await claimTeam(leagueId, user, "GB");
  // three awful years with Green Bay, then the offseason review
  await withLeague(leagueId, async ({ state }) => {
    const gm = state.gms.find((g) => g.teamCode === "GB")!;
    for (let i = 0; i < 3; i++) {
      state.history.push({
        season: state.season - 2 + i,
        gmId: gm.id,
        teamCode: "GB",
        madePlayoffs: false,
        seed: 0,
        furthestRound: "none",
        wonSuperBowl: false,
        regularSeasonRecord: { wins: 3, losses: 14, ties: 0 },
        eliminationMargin: null,
        pointDifferential: -150,
        rivalsEliminated: [],
      });
    }
    state.stage = "offseasonHotSeat";
    options = ensureHotSeat(state).entries[0]!.options;
    return { result: null, state };
  });
});

afterAll(async () => {
  if (reachable) {
    await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [user]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const maybe = (name: string, fn: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await fn();
  });

describe("being fired", () => {
  maybe("offers five teams, and refuses one that isn't on the list", async () => {
    expect(options).toHaveLength(5);
    const actor = await actorFor(leagueId, user);
    const notOffered = ["DAL", "SF", "PHI", "BAL", "LAR", "KC", "BUF", "DET"].find((c) => !options.includes(c))!;
    await expect(chooseJob(actor, notOffered)).rejects.toThrow(/isn't hiring/);
  });

  maybe("moves the GM to the team they pick, and every later action finds them there", async () => {
    const actor = await actorFor(leagueId, user);
    const pick = options[1]!;
    await chooseJob(actor, pick);
    const after = await actorFor(leagueId, user);
    expect(after.teamCode).toBe(pick);
    await withLeague(leagueId, async ({ state }) => {
      expect(state.teams[pick]!.controlledBy).toEqual({ kind: "human", gmId: actor.gmId });
      expect(state.teams.GB!.controlledBy).toEqual({ kind: "ai" });
      return { result: null, state, unchanged: true };
    });
    await expect(chooseJob(after, options[2]!)).rejects.toThrow(/already/);
  });
});
