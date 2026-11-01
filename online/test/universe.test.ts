import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";

import { pool } from "../src/db.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";
import { createOnlineLeague } from "../src/leagues.js";

/**
 * A commissioner chooses the player universe when creating a league: legacy
 * real players, fictional, or fictional conditioned on a historical era. It is
 * validated server-side and fixed afterwards. Needs a database.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const userId = `universe_user_${Date.now()}`;
const made: string[] = [];

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  await pool.query(`INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`, [userId]);
});

afterAll(async () => {
  if (reachable) {
    for (const id of made) await pool.query(`DELETE FROM leagues WHERE id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

const stateOf = async (id: string) => (await pool.query(`SELECT state FROM league_state WHERE league_id = $1`, [id])).rows[0].state as LeagueState;

describe("online league universe", () => {
  it.skipIf(!url)("creates legacy, fictional and era leagues with the matching pools", async () => {
    if (!reachable) return;
    const mk = async (name: string, config: Record<string, unknown>) => {
      const r = await createOnlineLeague(userId, { name, humanSlots: 2, config });
      made.push(r.leagueId);
      return stateOf(r.leagueId);
    };
    const legacy = await mk("Legacy league", { playerPool: "legacy" });
    const fiction = await mk("Fiction league", { playerPool: "fictional" });
    const era = await mk("Era league", { playerPool: "fictional", leagueEra: "2011" });
    expect(legacy.dna).toBeUndefined();
    expect(fiction.dna).toBeDefined();
    expect(fiction.dna?.eraTarget).toBeUndefined();
    expect(era.dna?.eraTarget).toBe("2011");
    expect(legacy.config.playerPool).toBe("legacy");
    expect(era.config.leagueEra).toBe("2011");
  });

  it.skipIf(!url)("rejects an unknown era and an era on a legacy league", async () => {
    if (!reachable) return;
    await expect(createOnlineLeague(userId, { name: "Bad era", config: { leagueEra: "1066" } })).rejects.toThrow();
    await expect(createOnlineLeague(userId, { name: "Bad combo", config: { playerPool: "legacy", leagueEra: "2011" } })).rejects.toThrow();
  });
});
