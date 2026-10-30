import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LeagueState } from "@/domain";
import { projectRatings, termSubject } from "@/state/contractValue.ts";
import { createLeague, DEFAULT_CONFIG } from "@/state/seed.ts";

import { signSession } from "../src/auth.js";
import { pool, readLeague } from "../src/db.js";
import { server } from "../src/index.js";
import { claimTeam, createOnlineLeague } from "../src/leagues.js";
import { stripPrivatePlayerFields } from "../src/privacyView.js";
import { prepareDatabase, requireDatabaseInCi } from "./requireDatabase.js";

/**
 * A player's hidden ceiling (`potential`) is server-private. The unit tests cover the redaction and what a client can
 * still do without it; the route tests call the real league route as a member and as a stranger and compare it with the
 * saved league, so "nothing leaked" cannot just mean "nothing was there". The route tests need a database.
 */
const fictional = () => createLeague(808, { ...DEFAULT_CONFIG, humanGmCount: 0 });

describe("stripPrivatePlayerFields", () => {
  it("removes every ceiling and leaves the rest of the player alone", () => {
    const s = fictional();
    const before = Object.values(s.players);
    expect(before.length).toBeGreaterThan(1500);
    expect(before.every((p) => typeof p.potential === "number")).toBe(true);
    const copy = JSON.parse(JSON.stringify(s)) as LeagueState;
    stripPrivatePlayerFields(copy);
    expect(JSON.stringify(copy)).not.toContain('"potential"');
    for (const p of before) {
      const { potential: _gone, ...rest } = p;
      void _gone;
      expect(copy.players[p.id]).toEqual(rest);
    }
    // the authoritative league is not touched by redacting a copy of it
    expect(Object.values(s.players).every((p) => typeof p.potential === "number")).toBe(true);
  });

  it("sends nothing derived from the ceiling either: no rounded, banded or offset stand-in", () => {
    const s = fictional();
    const copy = JSON.parse(JSON.stringify(s)) as LeagueState;
    stripPrivatePlayerFields(copy);
    // a different league with the same players but different ceilings is indistinguishable to a client
    const other = JSON.parse(JSON.stringify(s)) as LeagueState;
    for (const p of Object.values(other.players)) p.potential = 99;
    stripPrivatePlayerFields(other);
    expect(JSON.stringify(other)).toBe(JSON.stringify(copy));
  });

  it("leaves client-side valuation working: a missing ceiling is priced on the league curve for his age", () => {
    const s = fictional();
    const young = Object.values(s.players).filter((p) => p.age <= 23 && p.overall >= 70).slice(0, 40);
    expect(young.length).toBeGreaterThan(5);
    for (const p of young) {
      const hidden = { ...p };
      delete hidden.potential;
      const seen = projectRatings(termSubject(hidden), 4);
      expect(seen).toHaveLength(4);
      expect(seen.every((v) => Number.isFinite(v) && v >= 40 && v <= 99)).toBe(true);
      // he still develops in the estimate (a young player is not priced as flat)
      expect(seen[3]!).toBeGreaterThanOrEqual(p.overall);
    }
  });
});

describe("the league route", () => {
  const url = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  const stamp = Date.now();
  const users = { member: `pot_member_${stamp}`, stranger: `pot_stranger_${stamp}` };
  let reachable = false;
  let leagueId = "";
  let baseUrl = "";

  beforeAll(async () => {
    if (!url) return requireDatabaseInCi("DATABASE_URL is not set");
    const attempt = await prepareDatabase(pool);
    reachable = attempt.reachable;
    if (!attempt.reachable) return requireDatabaseInCi(`The database could not be reached: ${attempt.failure}`);
    for (const u of Object.values(users)) {
      await pool.query(
        `INSERT INTO users (id, name, name_folded, password_hash, password_salt) VALUES ($1, $1, $1, 'x', 'y') ON CONFLICT DO NOTHING`,
        [u],
      );
    }
    leagueId = (await createOnlineLeague(users.member, { name: "Potential Privacy", humanSlots: 2 })).leagueId;
    await claimTeam(leagueId, users.member, "GB");
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (reachable) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.query(`DELETE FROM leagues WHERE id = $1`, [leagueId]).catch(() => {});
      for (const u of Object.values(users)) await pool.query(`DELETE FROM users WHERE id = $1`, [u]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  const maybe = (name: string, fn: () => Promise<void>) =>
    it(url ? name : `${name} — SKIPPED, no DATABASE_URL`, async () => {
      if (!reachable) return;
      await fn();
    });
  const get = (user: string) => fetch(`${baseUrl}/leagues/${leagueId}`, { headers: { cookie: `sid=${signSession(user)}` } });

  maybe("keeps the true ceilings in the saved league but sends none to a member", async () => {
    const raw = (await readLeague(leagueId))!.state;
    const ceilings = Object.values(raw.players).filter((p) => typeof p.potential === "number");
    expect(ceilings.length, "the fixture holds ceilings to leak").toBeGreaterThan(1500);
    const res = await get(users.member);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('"potential"');
    const state = (JSON.parse(text) as { state: LeagueState }).state;
    expect(Object.keys(state.players).length).toBe(Object.keys(raw.players).length);
    expect(Object.values(state.players).some((p) => "potential" in p)).toBe(false);
    // the hidden prospect rating stays hidden as well
    expect(state.draftClass.every((p) => p.trueOverall === 0)).toBe(true);
  });

  maybe("sends a non-member nothing at all", async () => {
    const res = await get(users.stranger);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("potential");
  });
});
