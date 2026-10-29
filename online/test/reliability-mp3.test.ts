import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { fillRosterGaps } from "@/state/seed.ts";

import { actorFor, proposeTrade, saveGamePlan, withdrawTrade } from "../src/actions.js";
import { ActionError, pool, withLeague } from "../src/db.js";
import { claimTeam, createOnlineLeague, leaveLeague, vacateSeat } from "../src/leagues.js";
import { readyUp } from "../src/phases.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * MP-3 (audit D5 and D6) on a real PostgreSQL.
 *
 * D5: a request accepted while a GM held a seat must not run once they no
 * longer do — vacated, left, or the seat taken by someone else — however long
 * it waited behind other writers.
 *
 * D6: submitting the same trade offer twice (double click, retry after a lost
 * response, two tabs) leaves one open offer, and both submissions get its id.
 *
 * Needs PostgreSQL; PGlite serialises every socket and cannot show either.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`m3_a_${stamp}`, `m3_b_${stamp}`, `m3_c_${stamp}`, `m3_d_${stamp}`] as const;
const made: string[] = [];

beforeAll(async () => {
  if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
  if (process.env.DB_POOL_MAX === "1") {
    throw new Error("This suite needs real concurrent connections (a pool of 1 would deadlock it). Run it against PostgreSQL without DB_POOL_MAX=1.");
  }
  const attempt = await prepareDatabase(pool);
  reachable = attempt.reachable;
  if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
  for (const u of users) {
    await pool.query(
      `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y')`,
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

const maybe = (name: string, body: () => Promise<void>) =>
  it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
    if (!reachable) return;
    await body();
  });

async function league(): Promise<{ id: string; gm: Record<string, string> }> {
  const { leagueId } = await createOnlineLeague(users[0], { name: "MP3", humanSlots: 3 });
  made.push(leagueId);
  const gm: Record<string, string> = {};
  gm.GB = (await claimTeam(leagueId, users[0], "GB")).gmId;
  gm.KC = (await claimTeam(leagueId, users[1], "KC")).gmId;
  gm.PIT = (await claimTeam(leagueId, users[2], "PIT")).gmId;
  return { id: leagueId, gm };
}
const snap = async (id: string) => {
  const r = await pool.query<{ state: LeagueState; version: string }>(
    `SELECT state, version FROM league_state WHERE league_id = $1`,
    [id],
  );
  return { state: r.rows[0]!.state, version: Number(r.rows[0]!.version) };
};
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("D5 — a request outlives the seat it was made for", () => {
  maybe("a request queued behind a long transaction is refused if the seat was vacated first", async () => {
    const f = await league();
    const stale = await actorFor(f.id, users[1]); // KC's request, accepted while KC held the seat
    // a long transaction holds the league; the commissioner's vacate queues first, KC's request after it
    const holder = withLeague(f.id, async ({ state }) => {
      await tick(700);
      return { result: null, state, unchanged: true };
    });
    await tick(100);
    const vacate = vacateSeat(f.id, users[0], "KC");
    await tick(100);
    const late = saveGamePlan(stale, { passRate: 0.9 }).catch((e: unknown) => e);
    await Promise.all([holder, vacate]);
    const err = await late;
    expect(err).toBeInstanceOf(ActionError);
    expect((err as ActionError).status).toBe(403);
    expect((await snap(f.id)).state.gamePlans?.KC).toBeUndefined();
  });

  maybe("a request is refused when someone else has since taken the same seat — and the new GM is unaffected", async () => {
    const f = await league();
    const staleA = await actorFor(f.id, users[1]);
    await vacateSeat(f.id, users[0], "KC");
    await claimTeam(f.id, users[3], "KC"); // a new GM, same team, same gmId
    const err = await saveGamePlan(staleA, { passRate: 0.9 }).catch((e: unknown) => e);
    expect((err as ActionError).status).toBe(403);
    expect((await snap(f.id)).state.gamePlans?.KC).toBeUndefined();
    // the new holder's own request goes through
    const mine = await actorFor(f.id, users[3]);
    await saveGamePlan(mine, { passRate: 0.9 });
    expect((await snap(f.id)).state.gamePlans?.KC).toBeDefined();
  });

  maybe("a ready from a GM who no longer holds the seat is refused and changes nothing", async () => {
    const f = await league();
    await pool.query(
      `UPDATE league_state SET state = jsonb_set(state, '{stage}', '"fantasyDraftSummary"'), version = version + 1 WHERE league_id = $1`,
      [f.id],
    );
    const staleA = await actorFor(f.id, users[1]);
    await vacateSeat(f.id, users[0], "KC");
    const before = await snap(f.id);
    const err = await readyUp(f.id, staleA.gmId, true, "fantasyDraftSummary", staleA).catch((e: unknown) => e);
    expect((err as ActionError).status).toBe(403);
    expect((await snap(f.id)).version).toBe(before.version);
    // a GM who still holds theirs is let through
    const gb = await actorFor(f.id, users[0]);
    const ok = await readyUp(f.id, gb.gmId, true, "fantasyDraftSummary", gb);
    expect(ok.stage).toBe("fantasyDraftSummary");
  });

  maybe("a GM leaving cannot vacate a seat that has since passed to someone else", async () => {
    const f = await league();
    await vacateSeat(f.id, users[0], "KC");
    await claimTeam(f.id, users[3], "KC");
    // user B's leave request was looked up when B held KC; it now finds D there
    const err = await vacateSeat(f.id, users[1], "KC", true).catch((e: unknown) => e);
    expect((err as ActionError).status).toBe(409);
    const held = await pool.query(`SELECT user_id FROM franchises WHERE league_id = $1 AND team_code = 'KC'`, [f.id]);
    expect(held.rows[0].user_id).toBe(users[3]);
    // and the ordinary leave still works
    await expect(leaveLeague(f.id, users[2])).resolves.toEqual({ ok: true });
  });
});

describe("D6 — the same trade offer, submitted again", () => {
  /** A league with rosters, in a stage where trading is open, and two tradeable players. */
  async function tradeLeague() {
    const f = await league();
    const { state } = await snap(f.id);
    fillRosterGaps(state);
    state.stage = "offseasonDepthChart";
    await pool.query(
      `UPDATE league_state SET state = $2, stage = $3, version = version + 1 WHERE league_id = $1`,
      [f.id, JSON.stringify(state), state.stage],
    );
    const pick = (team: string, n: number) =>
      Object.values(state.players)
        .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent && p.position === "WR")
        .sort((a, b) => a.overall - b.overall)[n]!.id;
    return { f, a: await actorFor(f.id, users[0]), mine: [pick("GB", 0), pick("GB", 1)], theirs: [pick("KC", 0), pick("KC", 1)] };
  }
  const offered = async (id: string) =>
    (await snap(id)).state.trades.filter((t) => t.status === "offered" && t.fromTeam === "GB" && t.toTeam === "KC");

  maybe("two simultaneous submissions leave one open offer, and both callers get its id", async () => {
    const { f, a, mine, theirs } = await tradeLeague();
    const [x, y] = await Promise.all([
      proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]),
      proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]),
    ]);
    const open = await offered(f.id);
    expect(open).toHaveLength(1);
    expect(x.tradeId).toBe(open[0]!.id);
    expect(y.tradeId).toBe(open[0]!.id);
  });

  maybe("a retry later, or with the assets in another order, is the same offer and changes nothing", async () => {
    const { f, a, mine, theirs } = await tradeLeague();
    const first = await proposeTrade(a, "KC", [mine[0]!, mine[1]!], [theirs[0]!]);
    const before = await snap(f.id);
    const again = await proposeTrade(a, "KC", [mine[1]!, mine[0]!], [theirs[0]!]);
    expect(again.tradeId).toBe(first.tradeId);
    expect((await snap(f.id)).version).toBe(before.version); // no write, so no re-download for anyone
    expect(await offered(f.id)).toHaveLength(1);
  });

  maybe("a genuinely different offer is still its own offer", async () => {
    const { f, a, mine, theirs } = await tradeLeague();
    await proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]);
    await proposeTrade(a, "KC", [mine[0]!], [theirs[1]!]);
    expect(await offered(f.id)).toHaveLength(2);
  });

  maybe("once an offer is withdrawn, the same offer can be made afresh", async () => {
    const { f, a, mine, theirs } = await tradeLeague();
    const first = await proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]);
    await withdrawTrade(a, first.tradeId);
    const second = await proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]);
    expect(second.tradeId).not.toBe(first.tradeId);
    expect(await offered(f.id)).toHaveLength(1);
  });

  maybe("a stale tab's retry carrying an old version is still refused with 409, as before", async () => {
    const { a, mine, theirs } = await tradeLeague();
    const err = await proposeTrade(a, "KC", [mine[0]!], [theirs[0]!], "1").catch((e: unknown) => e);
    expect((err as ActionError).status).toBe(409);
  });
});
