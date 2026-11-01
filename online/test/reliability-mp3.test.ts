import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { fillRosterGaps } from "@/state/seed.ts";
import { emptyReveal } from "@/state/reveal.ts";
import { beginTradeDeadline } from "@/state/tradeDeadline.ts";

import { actorFor, deadlineTurn, proposeTrade, saveGamePlan } from "../src/actions.js";
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

describe("D6 — the same deadline offer, submitted again", () => {
  /**
   * Ad-hoc proposals are closed (the Trade Deadline is the one trading window), so the double-submit and concurrency guarantees this
   * block used to pin on `proposeTrade` are pinned here on the deadline turn, which is the path that can still be double-clicked.
   */
  async function deadlineLeague() {
    const f = await league();
    const { state } = await snap(f.id);
    fillRosterGaps(state);
    state.stage = "regularSeason";
    state.week = 9;
    state.reveal = emptyReveal();
    beginTradeDeadline(state);
    state.stage = "tradeDeadline";
    state.tradeDeadline!.index = state.tradeDeadline!.order.indexOf("GB"); // GB is on the clock
    await pool.query(
      `UPDATE league_state SET state = $2, stage = $3, version = version + 1 WHERE league_id = $1`,
      [f.id, JSON.stringify(state), state.stage],
    );
    const pick = (team: string, n: number) =>
      Object.values(state.players)
        .filter((p) => p.nfl_team === team && !p.retired && !p.free_agent && p.position === "WR")
        .sort((a, b) => a.overall - b.overall)[n]!.id;
    const move = (g: string, w: string) => ({ kind: "propose" as const, toTeam: "KC", give: [g], get: [w] });
    return { f, a: await actorFor(f.id, users[0]), mine: [pick("GB", 0), pick("GB", 1)], theirs: [pick("KC", 0), pick("KC", 1)], move };
  }
  const active = async (id: string) => (await snap(id)).state.tradeDeadline?.active ?? null;

  maybe("two simultaneous submissions open one negotiation; the other is refused", async () => {
    const { f, a, mine, theirs, move } = await deadlineLeague();
    const results = await Promise.allSettled([
      deadlineTurn(a, move(mine[0]!, theirs[0]!)),
      deadlineTurn(a, move(mine[0]!, theirs[0]!)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled"), JSON.stringify(results)).toHaveLength(1);
    const open = await active(f.id);
    expect(open?.fromTeam).toBe("GB");
    expect(open?.toTeam).toBe("KC");
    expect(open?.awaiting).toBe("recipient");
  });

  maybe("a retry later, or with the assets in another order, is refused and changes nothing", async () => {
    const { f, a, mine, theirs, move } = await deadlineLeague();
    await deadlineTurn(a, { kind: "propose", toTeam: "KC", give: [mine[0]!, mine[1]!], get: [theirs[0]!] });
    const before = await snap(f.id);
    const err = await deadlineTurn(a, { kind: "propose", toTeam: "KC", give: [mine[1]!, mine[0]!], get: [theirs[0]!] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect((await snap(f.id)).version).toBe(before.version); // refused, so no write and no re-download for anyone
    void move;
  });

  maybe("a different offer cannot start while one is open", async () => {
    const { f, a, mine, theirs, move } = await deadlineLeague();
    await deadlineTurn(a, move(mine[0]!, theirs[0]!));
    const first = await active(f.id);
    const err = await deadlineTurn(a, move(mine[0]!, theirs[1]!)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActionError);
    expect((await active(f.id))?.id).toBe(first?.id);
  });

  maybe("the old instant-proposal route is closed in every stage and writes nothing", async () => {
    const { f, a, mine, theirs } = await deadlineLeague();
    for (const stage of ["tradeDeadline", "offseasonDepthChart"] as const) {
      const { state } = await snap(f.id);
      state.stage = stage;
      await pool.query(`UPDATE league_state SET state = $2, stage = $3, version = version + 1 WHERE league_id = $1`, [f.id, JSON.stringify(state), stage]);
      const before = await snap(f.id);
      const err = await proposeTrade(a, "KC", [mine[0]!], [theirs[0]!]).catch((e: unknown) => e);
      expect((err as ActionError).status, stage).toBe(409);
      expect((await snap(f.id)).version).toBe(before.version);
      expect((await snap(f.id)).state.trades).toHaveLength(0);
    }
  });
});
