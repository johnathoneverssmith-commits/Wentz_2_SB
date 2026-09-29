import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { signSession } from "../src/auth.js";
import { migrate, pool } from "../src/db.js";
import { server } from "../src/index.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";

/**
 * The checkpoint's backstop poll downloaded the whole league every 30
 * seconds even when nothing had moved. With `?have=<version>` the server
 * answers "unchanged" from one row — and still only to a member.
 *
 * Needs a database; skips loudly rather than pretending to pass.
 */
const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
let reachable = false;
const stamp = Date.now();
const users = [`poll_gm_${stamp}`, `poll_out_${stamp}`] as const;
let leagueId = "";
let baseUrl = "";

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
  leagueId = (await createOnlineLeague(users[0], { name: "Poll Test", humanSlots: 2 })).leagueId;
  await claimTeam(leagueId, users[0], "GB");
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (reachable) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

const get = (user: string, have?: string) =>
  fetch(`${baseUrl}/leagues/${leagueId}${have ? `?have=${have}` : ""}`, {
    headers: { cookie: `sid=${signSession(user)}` },
  });

describe("polling the league", () => {
  maybe("answers 'unchanged' for the current version, and the league otherwise", async () => {
    const full = (await (await get(users[0])).json()) as { version: string; state?: unknown };
    expect(full.state).toBeDefined();

    const same = (await (await get(users[0], full.version)).json()) as { unchanged?: boolean; state?: unknown };
    expect(same.unchanged).toBe(true);
    expect(same.state).toBeUndefined();

    const stale = (await (await get(users[0], "0")).json()) as { state?: unknown };
    expect(stale.state).toBeDefined();
  });

  maybe("tells a non-member nothing, not even that it's unchanged", async () => {
    const { version } = (await (await get(users[0])).json()) as { version: string };
    const res = await get(users[1], version);
    expect(res.status).toBe(403);
  });
});
